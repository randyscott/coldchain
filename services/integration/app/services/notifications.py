"""
Notification Service
====================

Sends alert notifications via email (SMTP) and SMS (Twilio).
"""

import logging
from uuid import UUID

import aiosmtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

from app.core.config import settings

logger = logging.getLogger(__name__)


async def send_alert_notification(
    rule: dict,
    reading: dict,
    trigger_value: float,
    alert_event_id: UUID,
):
    """
    Dispatch alert notifications to all configured channels.
    """
    channels = rule.get("notify_channels", ["email"])
    if isinstance(channels, str):
        channels = [channels]

    device_name = reading.get("device_name", "Unknown")
    metric = rule.get("metric", "temperature")
    threshold = rule.get("threshold_value", 0)
    operator_str = {
        "gt": "above", "gte": "at or above",
        "lt": "below", "lte": "at or below",
    }.get(rule.get("operator", "gt"), "exceeding")

    unit = {"temperature": "°C", "humidity": "%", "battery_voltage": "V"}.get(metric, "")

    subject = f"⚠️ Cold Chain Alert: {rule['name']}"
    body = (
        f"Alert: {rule['name']}\n"
        f"Device: {device_name}\n"
        f"Current {metric}: {trigger_value}{unit}\n"
        f"Threshold: {operator_str} {threshold}{unit}\n"
        f"Rule type: {rule.get('rule_type', 'threshold')}\n"
        f"\n"
        f"Please check the dashboard for details.\n"
        f"Alert ID: {alert_event_id}\n"
    )

    for channel in channels:
        try:
            if channel == "email":
                await _send_email(subject, body)
            elif channel == "sms":
                await _send_sms(body)
            else:
                logger.warning(f"Unknown notification channel: {channel}")
        except Exception:
            logger.exception(f"Failed to send {channel} notification for {rule['name']}")


async def _send_email(subject: str, body: str):
    """Send an email alert via SMTP."""
    if not settings.smtp_host:
        logger.warning("SMTP not configured, skipping email notification")
        return

    message = MIMEMultipart()
    message["From"] = settings.smtp_from_email
    # TODO: Look up notification recipients from the database
    # For now, send to a default address
    message["To"] = "alerts@coldchain.local"
    message["Subject"] = subject
    message.attach(MIMEText(body, "plain"))

    try:
        await aiosmtplib.send(
            message,
            hostname=settings.smtp_host,
            port=settings.smtp_port,
            username=settings.smtp_username or None,
            password=settings.smtp_password or None,
            use_tls=settings.smtp_use_tls,
        )
        logger.info(f"📧 Email sent: {subject}")
    except Exception:
        logger.exception(f"Failed to send email: {subject}")


async def _send_sms(body: str):
    """Send an SMS alert via Twilio."""
    if not settings.twilio_account_sid:
        logger.debug("Twilio not configured, skipping SMS notification")
        return

    try:
        import httpx

        url = (
            f"https://api.twilio.com/2010-04-01/Accounts/"
            f"{settings.twilio_account_sid}/Messages.json"
        )

        async with httpx.AsyncClient() as client:
            response = await client.post(
                url,
                auth=(settings.twilio_account_sid, settings.twilio_auth_token),
                data={
                    "From": settings.twilio_from_number,
                    # TODO: Look up recipient phone numbers from notification_preferences
                    "To": "+10000000000",
                    "Body": body[:1600],  # Twilio SMS limit
                },
            )
            response.raise_for_status()
            logger.info(f"📱 SMS sent: {body[:50]}...")

    except Exception:
        logger.exception("Failed to send SMS")
