"""
Pydantic models for API request/response schemas.
"""

from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field


# =============================================================================
# Groups
# =============================================================================

class GroupOut(BaseModel):
    id: UUID
    name: str
    slug: str
    created_at: datetime


# =============================================================================
# Systems
# =============================================================================

class SystemCreate(BaseModel):
    name: str
    description: Optional[str] = None
    system_type: str = Field(default="fixed", pattern="^(fixed|transport)$")
    address: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    timezone: str = "UTC"


class SystemUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    address: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    timezone: Optional[str] = None
    is_active: Optional[bool] = None


class SystemOut(BaseModel):
    id: UUID
    group_id: UUID
    name: str
    description: Optional[str]
    system_type: str
    address: Optional[str]
    latitude: Optional[float]
    longitude: Optional[float]
    timezone: str
    is_active: bool
    chirpstack_application_id: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    # Computed fields added by the API
    sensor_count: int = 0
    gateway_count: int = 0
    active_alert_count: int = 0


# =============================================================================
# Devices
# =============================================================================

class DeviceCreate(BaseModel):
    system_id: UUID
    dev_eui: str = Field(min_length=16, max_length=16)
    device_type: str = Field(pattern="^(gateway|sensor)$")
    manufacturer: Optional[str] = None
    model: Optional[str] = None
    name: str
    description: Optional[str] = None
    # ChirpStack OTAA registration fields (sensors only)
    device_profile_id: Optional[str] = None   # ChirpStack device profile UUID
    app_eui: Optional[str] = Field(default=None, min_length=16, max_length=16)  # JoinEUI / AppEUI (hex)
    app_key: Optional[str] = Field(default=None, min_length=32, max_length=32)  # OTAA AppKey (hex)


class DeviceUpdate(BaseModel):
    system_id: Optional[UUID] = None
    name: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None


class DeviceProfileCreate(BaseModel):
    name: str
    description: Optional[str] = None
    region: str = Field(default="EU868")
    mac_version: str = Field(default="LORAWAN_1_0_3")
    reg_params_revision: str = Field(default="RP002_1_0_3")
    supports_otaa: bool = True
    supports_class_b: bool = False
    supports_class_c: bool = False
    uplink_interval: int = Field(default=3600, ge=0, description="Expected uplink interval in seconds")
    flush_queue_on_activate: bool = True
    device_status_req_interval: int = Field(default=1, ge=0)
    adr_algorithm_id: str = "default"


class DeviceProfileOut(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    region: str
    mac_version: str
    reg_params_revision: str
    supports_otaa: bool
    supports_class_b: bool
    supports_class_c: bool


class DeviceOut(BaseModel):
    id: UUID
    system_id: UUID
    dev_eui: str
    device_type: str
    manufacturer: Optional[str]
    model: Optional[str]
    name: str
    description: Optional[str]
    firmware_version: Optional[str]
    last_seen_at: Optional[datetime]
    battery_level: Optional[float]
    signal_rssi: Optional[int]
    signal_snr: Optional[float]
    chirpstack_device_profile_id: Optional[str] = None
    is_active: bool
    created_at: datetime
    # Latest reading (optionally populated)
    latest_temperature: Optional[float] = None
    latest_humidity: Optional[float] = None


# =============================================================================
# Sensor Readings
# =============================================================================

class ReadingOut(BaseModel):
    time: datetime
    device_id: UUID
    temperature: Optional[float]
    humidity: Optional[float]
    battery_voltage: Optional[float]
    latitude: Optional[float]
    longitude: Optional[float]
    rssi: Optional[int]
    snr: Optional[float]


class ReadingAggregateOut(BaseModel):
    bucket: datetime
    device_id: UUID
    avg_temperature: Optional[float]
    min_temperature: Optional[float]
    max_temperature: Optional[float]
    avg_humidity: Optional[float]
    min_humidity: Optional[float]
    max_humidity: Optional[float]
    reading_count: int


# =============================================================================
# Alert Rules
# =============================================================================

class AlertRuleCreate(BaseModel):
    system_id: UUID
    device_id: Optional[UUID] = None
    name: str
    description: Optional[str] = None
    rule_type: str = Field(pattern="^(threshold|duration|rate_of_change|connectivity|battery)$")
    metric: str = Field(default="temperature", pattern="^(temperature|humidity|battery_voltage)$")
    operator: str = Field(default="gt", pattern="^(gt|gte|lt|lte)$")
    threshold_value: float
    duration_seconds: int = 0
    rate_period_seconds: Optional[int] = None
    silence_seconds: Optional[int] = None
    notify_channels: list[str] = ["email"]
    escalation_minutes: Optional[int] = None


class AlertRuleUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    threshold_value: Optional[float] = None
    duration_seconds: Optional[int] = None
    notify_channels: Optional[list[str]] = None
    escalation_minutes: Optional[int] = None
    is_active: Optional[bool] = None


class AlertRuleOut(BaseModel):
    id: UUID
    system_id: UUID
    device_id: Optional[UUID]
    name: str
    description: Optional[str]
    rule_type: str
    metric: str
    operator: str
    threshold_value: float
    duration_seconds: int
    notify_channels: list
    escalation_minutes: Optional[int]
    is_active: bool
    created_at: datetime


# =============================================================================
# Alert Events
# =============================================================================

class AlertEventOut(BaseModel):
    id: UUID
    alert_rule_id: UUID
    device_id: UUID
    triggered_at: datetime
    resolved_at: Optional[datetime]
    trigger_value: Optional[float]
    peak_value: Optional[float]
    notified_channels: Optional[list]
    acknowledged_at: Optional[datetime]
    acknowledged_by: Optional[UUID]
    acknowledge_note: Optional[str]
    # Joined fields
    rule_name: Optional[str] = None
    device_name: Optional[str] = None
    system_name: Optional[str] = None


class AlertAcknowledge(BaseModel):
    note: Optional[str] = None


# =============================================================================
# Dashboard Summary
# =============================================================================

class SystemSummary(BaseModel):
    system_id: UUID
    system_name: str
    system_type: str
    sensor_count: int
    gateway_count: int
    active_alerts: int
    sensors_reporting: int
    worst_temperature: Optional[float]
    worst_sensor_name: Optional[str]
    last_reading_at: Optional[datetime]
