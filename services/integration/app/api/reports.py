"""
Reports API — Compliance report generation.

GET /reports/compliance
  Generates a temperature compliance report for a system over a time range.
  Supports CSV (raw hourly data) and PDF (formatted compliance document).

Auth: any authenticated user in the group (viewer+).
"""

import csv
import io
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from jinja2 import Environment, FileSystemLoader
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import CurrentUser, get_current_user
from app.core.database import get_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/reports", tags=["reports"])

# Jinja2 env pointing at the templates directory
_TEMPLATES_DIR = Path(__file__).parent.parent / "templates"
_jinja_env = Environment(loader=FileSystemLoader(str(_TEMPLATES_DIR)), autoescape=True)


# =============================================================================
# Helpers
# =============================================================================

def _fmt_temp(v) -> str:
    if v is None:
        return "—"
    return f"{float(v):.2f}"


def _fmt_duration(seconds: float | None) -> str:
    if seconds is None or seconds < 0:
        return "—"
    seconds = int(seconds)
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    if h:
        return f"{h}h {m:02d}m"
    if m:
        return f"{m}m {s:02d}s"
    return f"{s}s"


def _fmt_dt(dt: datetime | None) -> str:
    if dt is None:
        return ""
    return dt.strftime("%Y-%m-%d %H:%M UTC")


async def _collect_report_data(
    db: AsyncSession,
    user: CurrentUser,
    system_id: UUID,
    start: datetime,
    end: datetime,
    device_id: UUID | None,
) -> dict:
    """
    Pull all data needed for both CSV and PDF reports.
    Returns a structured dict ready for template rendering or CSV writing.
    """

    # ── System + group ────────────────────────────────────────────────────────
    sys_result = await db.execute(
        text("""
            SELECT s.*, g.name AS group_name
            FROM systems s
            JOIN groups g ON s.group_id = g.id
            WHERE s.id = :sid AND s.group_id = :gid
        """),
        {"sid": system_id, "gid": user.group_id},
    )
    system_row = sys_result.mappings().first()
    if not system_row:
        raise HTTPException(status_code=404, detail="System not found")

    # ── Devices (sensors only) ────────────────────────────────────────────────
    device_filter = "AND d.id = :device_id" if device_id else ""
    dev_result = await db.execute(
        text(f"""
            SELECT id, name, dev_eui, manufacturer, model
            FROM devices
            WHERE system_id = :sid AND device_type = 'sensor' AND is_active = TRUE
            {device_filter}
            ORDER BY name
        """),
        {"sid": system_id, **({"device_id": device_id} if device_id else {})},
    )
    devices = [dict(r) for r in dev_result.mappings().all()]
    if not devices:
        raise HTTPException(status_code=404, detail="No sensors found for this system")

    device_ids = [d["id"] for d in devices]

    # ── Hourly aggregates ─────────────────────────────────────────────────────
    hourly_result = await db.execute(
        text("""
            SELECT bucket, device_id,
                   avg_temperature, min_temperature, max_temperature, reading_count
            FROM sensor_readings_hourly
            WHERE device_id = ANY(:ids)
              AND bucket >= :start AND bucket < :end
            ORDER BY bucket ASC
        """),
        {"ids": device_ids, "start": start, "end": end},
    )
    hourly_rows = [dict(r) for r in hourly_result.mappings().all()]

    # Build per-device lookup
    hourly_by_device: dict[UUID, list[dict]] = {d["id"]: [] for d in devices}
    for row in hourly_rows:
        hourly_by_device[row["device_id"]].append(row)

    # ── Daily aggregates (for PDF per-sensor tables) ──────────────────────────
    daily_result = await db.execute(
        text("""
            SELECT bucket, device_id,
                   avg_temperature, min_temperature, max_temperature, reading_count
            FROM sensor_readings_daily
            WHERE device_id = ANY(:ids)
              AND bucket >= :start AND bucket < :end
            ORDER BY bucket ASC
        """),
        {"ids": device_ids, "start": start, "end": end},
    )
    daily_by_device: dict[UUID, list[dict]] = {d["id"]: [] for d in devices}
    for row in [dict(r) for r in daily_result.mappings().all()]:
        daily_by_device[row["device_id"]].append(row)

    # ── Temperature excursions (alert events on temperature rules) ────────────
    exc_filter = "AND ae.device_id = :device_id" if device_id else ""
    exc_result = await db.execute(
        text(f"""
            SELECT ae.id, ae.device_id, ae.triggered_at, ae.resolved_at,
                   ae.trigger_value, ae.peak_value,
                   ae.acknowledged_at, ae.acknowledge_note,
                   ar.name  AS rule_name,
                   ar.threshold_value, ar.operator,
                   d.name   AS device_name,
                   u.display_name AS acknowledged_by
            FROM alert_events ae
            JOIN alert_rules ar ON ae.alert_rule_id = ar.id
            JOIN devices d      ON ae.device_id = d.id
            LEFT JOIN users u   ON ae.acknowledged_by = u.id
            WHERE d.system_id = :sid
              AND ar.metric = 'temperature'
              AND ae.triggered_at >= :start AND ae.triggered_at < :end
              {exc_filter}
            ORDER BY ae.triggered_at
        """),
        {"sid": system_id, "start": start, "end": end,
         **({"device_id": device_id} if device_id else {})},
    )
    excursions = [dict(r) for r in exc_result.mappings().all()]
    exc_by_device: dict[UUID, list[dict]] = {d["id"]: [] for d in devices}
    for e in excursions:
        exc_by_device[e["device_id"]].append(e)

    # ── Per-sensor stats ──────────────────────────────────────────────────────
    now = datetime.now(timezone.utc)
    sensor_stats = []
    for dev in devices:
        did = dev["id"]
        rows = hourly_by_device[did]

        total_readings = sum(r["reading_count"] for r in rows)
        mins  = [r["min_temperature"] for r in rows if r["min_temperature"] is not None]
        maxs  = [r["max_temperature"] for r in rows if r["max_temperature"] is not None]
        # Weighted average
        weighted = [(r["avg_temperature"], r["reading_count"])
                    for r in rows if r["avg_temperature"] is not None]
        avg = (sum(a * c for a, c in weighted) / sum(c for _, c in weighted)
               if weighted else None)

        sensor_excursions = exc_by_device[did]
        exc_duration_total = sum(
            ((e["resolved_at"] or now) - e["triggered_at"]).total_seconds()
            for e in sensor_excursions
        )

        # Daily rows with excursion flag
        daily_rows = []
        for dr in daily_by_device[did]:
            bucket: datetime = dr["bucket"]
            bucket_date = bucket.date()
            day_start = datetime(bucket_date.year, bucket_date.month, bucket_date.day,
                                 tzinfo=timezone.utc)
            day_end = day_start + timedelta(days=1)
            has_exc = any(
                e["triggered_at"] < day_end and (e["resolved_at"] or now) >= day_start
                for e in sensor_excursions
            )
            daily_rows.append({
                "date":          bucket.strftime("%Y-%m-%d"),
                "reading_count": dr["reading_count"],
                "min_temp":      dr["min_temperature"],
                "avg_temp":      dr["avg_temperature"],
                "max_temp":      dr["max_temperature"],
                "has_excursion": has_exc,
            })

        sensor_stats.append({
            "id":                     did,
            "name":                   dev["name"],
            "dev_eui":                dev["dev_eui"],
            "manufacturer":           dev["manufacturer"],
            "model":                  dev["model"],
            "total_readings":         total_readings,
            "min_temp":               min(mins) if mins else None,
            "avg_temp":               avg,
            "max_temp":               max(maxs) if maxs else None,
            "min_temp_str":           _fmt_temp(min(mins) if mins else None),
            "avg_temp_str":           _fmt_temp(avg),
            "max_temp_str":           _fmt_temp(max(maxs) if maxs else None),
            "excursion_count":        len(sensor_excursions),
            "excursion_duration_str": _fmt_duration(exc_duration_total) if sensor_excursions else "—",
            "daily_rows":             daily_rows,
        })

    # ── Global summary ────────────────────────────────────────────────────────
    all_mins = [s["min_temp"] for s in sensor_stats if s["min_temp"] is not None]
    all_maxs = [s["max_temp"] for s in sensor_stats if s["max_temp"] is not None]
    total_readings = sum(s["total_readings"] for s in sensor_stats)
    weighted_global = [(s["avg_temp"], s["total_readings"])
                       for s in sensor_stats if s["avg_temp"] is not None]
    global_avg = (sum(a * c for a, c in weighted_global) / sum(c for _, c in weighted_global)
                  if weighted_global else None)

    exc_duration_total = sum(
        ((e["resolved_at"] or now) - e["triggered_at"]).total_seconds()
        for e in excursions
    )
    period_hours = max(1, int((end - start).total_seconds() / 3600))

    summary = {
        "sensor_count":           len(devices),
        "total_readings":         total_readings,
        "period_hours":           period_hours,
        "excursion_count":        len(excursions),
        "excursion_duration_str": _fmt_duration(exc_duration_total) if excursions else "—",
        "global_min_str":         _fmt_temp(min(all_mins) if all_mins else None),
        "global_max_str":         _fmt_temp(max(all_maxs) if all_maxs else None),
        "global_avg_str":         _fmt_temp(global_avg),
    }

    # ── Excursion rows for PDF detail table ───────────────────────────────────
    all_excursions = []
    for e in excursions:
        duration = ((e["resolved_at"] or now) - e["triggered_at"]).total_seconds()
        all_excursions.append({
            **e,
            "triggered_at_str":  _fmt_dt(e["triggered_at"]),
            "resolved_at_str":   _fmt_dt(e["resolved_at"]) if e["resolved_at"] else None,
            "acknowledged_at_str": _fmt_dt(e["acknowledged_at"]) if e["acknowledged_at"] else None,
            "duration_str":      _fmt_duration(duration),
        })

    return {
        "system":         dict(system_row),
        "group_name":     system_row["group_name"],
        "summary":        summary,
        "sensors":        sensor_stats,
        "all_excursions": all_excursions,
        "hourly_rows":    hourly_rows,   # used by CSV
        "device_map":     {d["id"]: d for d in devices},
    }


# =============================================================================
# CSV generation
# =============================================================================

def _build_csv(data: dict) -> bytes:
    """
    Returns a UTF-8 BOM CSV with two sections:
      1. Hourly aggregate readings (all sensors)
      2. Temperature excursions
    """
    out = io.StringIO()
    w = csv.writer(out)

    system = data["system"]
    summary = data["summary"]
    device_map = data["device_map"]

    # Header block
    w.writerow(["Cold Chain Monitor — Temperature Compliance Report"])
    w.writerow(["System", system["name"]])
    if system.get("address"):
        w.writerow(["Location", system["address"]])
    w.writerow(["Group", data["group_name"]])
    w.writerow(["Period", f"{data['period_start']} — {data['period_end']}"])
    w.writerow(["Generated", data["generated_at"]])
    w.writerow(["Generated by", data["generated_by"]])
    w.writerow([])

    # Summary block
    w.writerow(["SUMMARY"])
    w.writerow(["Sensors monitored", summary["sensor_count"]])
    w.writerow(["Total readings", summary["total_readings"]])
    w.writerow(["Period (hours)", summary["period_hours"]])
    w.writerow(["Temperature excursions", summary["excursion_count"]])
    w.writerow(["Total excursion time", summary["excursion_duration_str"]])
    w.writerow(["Min temperature (°C)", summary["global_min_str"]])
    w.writerow(["Avg temperature (°C)", summary["global_avg_str"]])
    w.writerow(["Max temperature (°C)", summary["global_max_str"]])
    w.writerow([])

    # Hourly readings
    w.writerow(["HOURLY READINGS"])
    w.writerow(["Hour (UTC)", "Sensor", "DevEUI",
                "Min °C", "Avg °C", "Max °C", "Reading Count"])
    for row in sorted(data["hourly_rows"], key=lambda r: (r["bucket"], r["device_id"])):
        dev = device_map.get(row["device_id"], {})
        w.writerow([
            row["bucket"].strftime("%Y-%m-%d %H:%M"),
            dev.get("name", ""),
            dev.get("dev_eui", "").upper(),
            f"{row['min_temperature']:.2f}" if row["min_temperature"] is not None else "",
            f"{row['avg_temperature']:.2f}" if row["avg_temperature"] is not None else "",
            f"{row['max_temperature']:.2f}" if row["max_temperature"] is not None else "",
            row["reading_count"],
        ])
    w.writerow([])

    # Excursions
    w.writerow(["TEMPERATURE EXCURSIONS"])
    w.writerow(["Sensor", "Rule", "Triggered (UTC)", "Resolved (UTC)",
                "Duration", "Trigger °C", "Peak °C",
                "Acknowledged at", "Acknowledged by", "Note"])
    for e in data["all_excursions"]:
        w.writerow([
            e["device_name"],
            e["rule_name"],
            e["triggered_at_str"],
            e["resolved_at_str"] or "Ongoing",
            e["duration_str"],
            f"{e['trigger_value']:.2f}" if e["trigger_value"] is not None else "",
            f"{e['peak_value']:.2f}" if e["peak_value"] is not None else "",
            e["acknowledged_at_str"] or "",
            e["acknowledged_by"] or "",
            e["acknowledge_note"] or "",
        ])

    # Return UTF-8 with BOM so Excel opens it correctly
    return ("\ufeff" + out.getvalue()).encode("utf-8")


# =============================================================================
# PDF generation
# =============================================================================

def _build_pdf(data: dict) -> bytes:
    try:
        from weasyprint import HTML as WeasyprintHTML
    except ImportError:
        raise HTTPException(
            status_code=501,
            detail="PDF generation requires weasyprint — not installed",
        )

    template = _jinja_env.get_template("compliance_report.html")
    html_str = template.render(**data)
    return WeasyprintHTML(string=html_str).write_pdf()


# =============================================================================
# Endpoint
# =============================================================================

@router.get("/compliance")
async def compliance_report(
    system_id: UUID = Query(..., description="System to report on"),
    start: datetime = Query(..., description="Report start (ISO 8601)"),
    end: datetime   = Query(..., description="Report end (ISO 8601)"),
    format: str     = Query("pdf", pattern="^(csv|pdf)$"),
    device_id: UUID | None = Query(None, description="Limit to a single sensor"),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession  = Depends(get_db),
):
    """
    Generate a compliance report for a system over a time range.

    - format=pdf  → formatted PDF document (default)
    - format=csv  → CSV with hourly data + excursion log
    """
    if end <= start:
        raise HTTPException(status_code=400, detail="end must be after start")
    if (end - start).days > 366:
        raise HTTPException(status_code=400, detail="Date range cannot exceed 366 days")

    # Ensure datetimes are tz-aware
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    if end.tzinfo is None:
        end = end.replace(tzinfo=timezone.utc)

    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    data = await _collect_report_data(db, user, system_id, start, end, device_id)
    data["period_start"]  = start.strftime("%Y-%m-%d %H:%M UTC")
    data["period_end"]    = end.strftime("%Y-%m-%d %H:%M UTC")
    data["generated_at"]  = now_str
    data["generated_by"]  = user.display_name or user.email

    system_slug = data["system"]["name"].replace(" ", "_")[:40]
    date_slug   = start.strftime("%Y%m%d") + "_" + end.strftime("%Y%m%d")

    if format == "csv":
        content  = _build_csv(data)
        filename = f"compliance_{system_slug}_{date_slug}.csv"
        return StreamingResponse(
            io.BytesIO(content),
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    else:
        content  = _build_pdf(data)
        filename = f"compliance_{system_slug}_{date_slug}.pdf"
        return StreamingResponse(
            io.BytesIO(content),
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
