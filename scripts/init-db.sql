-- =============================================================================
-- Cold Chain Monitoring System — Database Schema
-- Run against the 'coldchain' database in TimescaleDB.
-- =============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- TENANT HIERARCHY
-- =============================================================================

-- Groups (top-level tenant)
CREATE TABLE IF NOT EXISTS groups (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(255) NOT NULL,
    slug            VARCHAR(255) NOT NULL UNIQUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_groups_slug ON groups(slug);

-- Users (belong to a group, synced from Keycloak)
CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    keycloak_id     VARCHAR(255) UNIQUE,
    group_id        UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    email           VARCHAR(255) NOT NULL,
    display_name    VARCHAR(255) NOT NULL,
    role            VARCHAR(50) NOT NULL DEFAULT 'viewer'
                    CHECK (role IN ('admin', 'manager', 'viewer')),
    phone           VARCHAR(50),               -- For SMS alerts
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_group_id ON users(group_id);
CREATE INDEX idx_users_keycloak_id ON users(keycloak_id);
CREATE INDEX idx_users_email ON users(email);

-- =============================================================================
-- SYSTEMS & DEVICES
-- =============================================================================

-- Systems (logical grouping: a warehouse, a truck, a cooler room)
CREATE TABLE IF NOT EXISTS systems (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id        UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    system_type     VARCHAR(50) NOT NULL DEFAULT 'fixed'
                    CHECK (system_type IN ('fixed', 'transport')),
    -- Location for fixed systems
    address         TEXT,
    latitude        DOUBLE PRECISION,
    longitude       DOUBLE PRECISION,
    -- Metadata
    timezone        VARCHAR(100) DEFAULT 'UTC',
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_systems_group_id ON systems(group_id);

-- Devices (gateways and sensors)
CREATE TABLE IF NOT EXISTS devices (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    system_id       UUID NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    dev_eui         VARCHAR(16) NOT NULL UNIQUE, -- LoRaWAN DevEUI (hex string)
    device_type     VARCHAR(50) NOT NULL
                    CHECK (device_type IN ('gateway', 'sensor')),
    manufacturer    VARCHAR(255),
    model           VARCHAR(255),
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    -- ChirpStack linkage
    chirpstack_device_id VARCHAR(255),
    -- Device metadata
    firmware_version VARCHAR(100),
    hardware_version VARCHAR(100),
    -- Operational state (updated by integration service)
    last_seen_at    TIMESTAMPTZ,
    battery_level   REAL,                       -- 0.0 to 1.0
    signal_rssi     INTEGER,                    -- dBm
    signal_snr      REAL,                       -- dB
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_devices_system_id ON devices(system_id);
CREATE INDEX idx_devices_dev_eui ON devices(dev_eui);
CREATE INDEX idx_devices_last_seen ON devices(last_seen_at);

-- =============================================================================
-- SENSOR READINGS (Time-Series — TimescaleDB Hypertable)
-- =============================================================================

CREATE TABLE IF NOT EXISTS sensor_readings (
    time            TIMESTAMPTZ NOT NULL,
    device_id       UUID NOT NULL,              -- References devices(id)
    -- Measurements (nullable: not all sensors report all fields)
    temperature     DOUBLE PRECISION,           -- Celsius
    humidity        DOUBLE PRECISION,           -- Relative humidity %
    battery_voltage DOUBLE PRECISION,           -- Volts
    -- Location (for transport sensors or GPS-equipped devices)
    latitude        DOUBLE PRECISION,
    longitude       DOUBLE PRECISION,
    -- Radio metadata
    rssi            INTEGER,
    snr             REAL,
    frame_count     INTEGER,
    -- Raw data for debugging / reprocessing
    raw_payload     TEXT,                        -- Hex-encoded raw LoRaWAN payload
    -- Deduplication
    chirpstack_id   VARCHAR(255)                 -- ChirpStack uplink event ID
);

-- Convert to hypertable (partitioned by time, 1-day chunks)
SELECT create_hypertable(
    'sensor_readings',
    by_range('time', INTERVAL '1 day'),
    if_not_exists => TRUE
);

-- Indexes for common query patterns
CREATE INDEX idx_readings_device_time
    ON sensor_readings (device_id, time DESC);

CREATE INDEX idx_readings_time
    ON sensor_readings (time DESC);

-- =============================================================================
-- CONTINUOUS AGGREGATES (Pre-computed rollups for dashboard performance)
-- =============================================================================

-- Hourly aggregates
CREATE MATERIALIZED VIEW IF NOT EXISTS sensor_readings_hourly
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', time) AS bucket,
    device_id,
    AVG(temperature)            AS avg_temperature,
    MIN(temperature)            AS min_temperature,
    MAX(temperature)            AS max_temperature,
    AVG(humidity)               AS avg_humidity,
    MIN(humidity)               AS min_humidity,
    MAX(humidity)               AS max_humidity,
    AVG(battery_voltage)        AS avg_battery_voltage,
    MIN(battery_voltage)        AS min_battery_voltage,
    COUNT(*)                    AS reading_count
FROM sensor_readings
GROUP BY bucket, device_id
WITH NO DATA;

-- Daily aggregates
CREATE MATERIALIZED VIEW IF NOT EXISTS sensor_readings_daily
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 day', time)  AS bucket,
    device_id,
    AVG(temperature)            AS avg_temperature,
    MIN(temperature)            AS min_temperature,
    MAX(temperature)            AS max_temperature,
    AVG(humidity)               AS avg_humidity,
    MIN(humidity)               AS min_humidity,
    MAX(humidity)               AS max_humidity,
    AVG(battery_voltage)        AS avg_battery_voltage,
    MIN(battery_voltage)        AS min_battery_voltage,
    COUNT(*)                    AS reading_count
FROM sensor_readings
GROUP BY bucket, device_id
WITH NO DATA;

-- Refresh policies: materialize aggregates automatically
SELECT add_continuous_aggregate_policy('sensor_readings_hourly',
    start_offset    => INTERVAL '3 hours',
    end_offset      => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour',
    if_not_exists   => TRUE
);

SELECT add_continuous_aggregate_policy('sensor_readings_daily',
    start_offset    => INTERVAL '3 days',
    end_offset      => INTERVAL '1 day',
    schedule_interval => INTERVAL '1 day',
    if_not_exists   => TRUE
);

-- =============================================================================
-- RETENTION POLICIES
-- =============================================================================

-- Drop raw readings older than 2 years
SELECT add_retention_policy('sensor_readings',
    drop_after => INTERVAL '2 years',
    if_not_exists => TRUE
);

-- Keep hourly aggregates for 5 years
SELECT add_retention_policy('sensor_readings_hourly',
    drop_after => INTERVAL '5 years',
    if_not_exists => TRUE
);

-- Daily aggregates kept indefinitely (no retention policy)

-- =============================================================================
-- COMPRESSION (for older raw data)
-- =============================================================================

ALTER TABLE sensor_readings SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'device_id',
    timescaledb.compress_orderby = 'time DESC'
);

-- Compress chunks older than 7 days
SELECT add_compression_policy('sensor_readings',
    compress_after => INTERVAL '7 days',
    if_not_exists => TRUE
);

-- =============================================================================
-- ALERT RULES & EVENTS
-- =============================================================================

CREATE TABLE IF NOT EXISTS alert_rules (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    system_id       UUID NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    device_id       UUID REFERENCES devices(id) ON DELETE CASCADE,  -- NULL = system-wide
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    -- Rule definition
    rule_type       VARCHAR(50) NOT NULL
                    CHECK (rule_type IN ('threshold', 'duration', 'rate_of_change',
                                         'connectivity', 'battery')),
    metric          VARCHAR(50) NOT NULL DEFAULT 'temperature'
                    CHECK (metric IN ('temperature', 'humidity', 'battery_voltage')),
    operator        VARCHAR(10) NOT NULL DEFAULT 'gt'
                    CHECK (operator IN ('gt', 'gte', 'lt', 'lte')),
    threshold_value DOUBLE PRECISION NOT NULL,
    -- Duration-based rules: trigger only after sustained breach
    duration_seconds INTEGER DEFAULT 0,
    -- Rate-of-change rules: degrees per hour
    rate_period_seconds INTEGER,
    -- Connectivity rules: seconds without data
    silence_seconds INTEGER,
    -- Notification config
    notify_channels JSONB NOT NULL DEFAULT '["email"]',
    escalation_minutes INTEGER,                  -- NULL = no escalation
    -- State
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_alert_rules_system ON alert_rules(system_id);
CREATE INDEX idx_alert_rules_device ON alert_rules(device_id);

-- Alert events (audit trail of every triggered alert)
CREATE TABLE IF NOT EXISTS alert_events (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    alert_rule_id   UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
    device_id       UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    -- Event lifecycle
    triggered_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at     TIMESTAMPTZ,                 -- NULL = still active
    -- Readings at trigger
    trigger_value   DOUBLE PRECISION,            -- The reading that triggered the alert
    peak_value      DOUBLE PRECISION,            -- Worst reading during excursion
    -- Notification tracking
    notified_at     TIMESTAMPTZ,
    notified_channels JSONB,                     -- ["email", "sms"]
    escalated_at    TIMESTAMPTZ,
    -- Acknowledgment
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by UUID REFERENCES users(id),
    acknowledge_note TEXT,
    -- Metadata
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_alert_events_rule ON alert_events(alert_rule_id);
CREATE INDEX idx_alert_events_device ON alert_events(device_id);
CREATE INDEX idx_alert_events_triggered ON alert_events(triggered_at DESC);
CREATE INDEX idx_alert_events_active ON alert_events(resolved_at)
    WHERE resolved_at IS NULL;

-- =============================================================================
-- AUDIT LOG
-- =============================================================================

CREATE TABLE IF NOT EXISTS audit_log (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id        UUID REFERENCES groups(id),
    user_id         UUID REFERENCES users(id),
    action          VARCHAR(100) NOT NULL,       -- e.g., 'device.created', 'alert_rule.updated'
    entity_type     VARCHAR(100),                -- e.g., 'device', 'alert_rule', 'system'
    entity_id       UUID,
    details         JSONB,                       -- Before/after or additional context
    ip_address      INET,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_log_group ON audit_log(group_id, created_at DESC);
CREATE INDEX idx_audit_log_user ON audit_log(user_id, created_at DESC);
CREATE INDEX idx_audit_log_entity ON audit_log(entity_type, entity_id);

-- =============================================================================
-- NOTIFICATION PREFERENCES
-- =============================================================================

CREATE TABLE IF NOT EXISTS notification_preferences (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel         VARCHAR(50) NOT NULL CHECK (channel IN ('email', 'sms')),
    enabled         BOOLEAN NOT NULL DEFAULT TRUE,
    -- Channel-specific config
    destination     VARCHAR(255) NOT NULL,       -- Email address or phone number
    -- Quiet hours (optional)
    quiet_start     TIME,                        -- e.g., 22:00
    quiet_end       TIME,                        -- e.g., 07:00
    -- Even during quiet hours, critical alerts go through
    critical_override BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, channel, destination)
);

-- =============================================================================
-- SEED DATA (for development)
-- =============================================================================

-- Create a demo group
INSERT INTO groups (id, name, slug) VALUES
    ('a0000000-0000-0000-0000-000000000001', 'Demo Organization', 'demo-org')
ON CONFLICT (slug) DO NOTHING;

-- Create a demo admin user
INSERT INTO users (id, group_id, email, display_name, role) VALUES
    ('b0000000-0000-0000-0000-000000000001',
     'a0000000-0000-0000-0000-000000000001',
     'admin@demo.local',
     'Demo Admin',
     'admin')
ON CONFLICT DO NOTHING;

-- Create demo systems
INSERT INTO systems (id, group_id, name, description, system_type, address, latitude, longitude) VALUES
    ('c0000000-0000-0000-0000-000000000001',
     'a0000000-0000-0000-0000-000000000001',
     'Main Warehouse',
     'Primary cold storage facility',
     'fixed',
     '123 Industrial Blvd, Madison, WI 53703',
     43.0731, -89.4012),
    ('c0000000-0000-0000-0000-000000000002',
     'a0000000-0000-0000-0000-000000000001',
     'Delivery Truck #1',
     'Refrigerated delivery vehicle',
     'transport',
     NULL, NULL, NULL)
ON CONFLICT DO NOTHING;

-- Create demo devices
INSERT INTO devices (id, system_id, dev_eui, device_type, manufacturer, model, name) VALUES
    -- Gateway at warehouse
    ('d0000000-0000-0000-0000-000000000001',
     'c0000000-0000-0000-0000-000000000001',
     '0000000000000001',
     'gateway', 'Ezurio', 'RG191',
     'Warehouse Gateway'),
    -- Sensors at warehouse
    ('d0000000-0000-0000-0000-000000000002',
     'c0000000-0000-0000-0000-000000000001',
     'A1B2C3D4E5F60001',
     'sensor', 'Ezurio', 'RS2621',
     'Walk-in Cooler #1'),
    ('d0000000-0000-0000-0000-000000000003',
     'c0000000-0000-0000-0000-000000000001',
     'A1B2C3D4E5F60002',
     'sensor', 'Ezurio', 'RS2621',
     'Walk-in Freezer #1'),
    ('d0000000-0000-0000-0000-000000000004',
     'c0000000-0000-0000-0000-000000000001',
     'A1B2C3D4E5F60003',
     'sensor', 'Ezurio', 'RS2621',
     'Loading Dock'),
    -- Transport sensor
    ('d0000000-0000-0000-0000-000000000005',
     'c0000000-0000-0000-0000-000000000002',
     'A1B2C3D4E5F60004',
     'sensor', 'Ezurio', 'RS2621',
     'Truck Cargo Area')
ON CONFLICT DO NOTHING;

-- Create demo alert rules
INSERT INTO alert_rules (system_id, device_id, name, rule_type, metric, operator, threshold_value, duration_seconds, notify_channels) VALUES
    -- Cooler: alert if temp > 4°C for more than 15 minutes
    ('c0000000-0000-0000-0000-000000000001',
     'd0000000-0000-0000-0000-000000000002',
     'Cooler High Temp', 'duration', 'temperature', 'gt', 4.0, 900,
     '["email", "sms"]'),
    -- Freezer: alert if temp > -15°C for more than 10 minutes
    ('c0000000-0000-0000-0000-000000000001',
     'd0000000-0000-0000-0000-000000000003',
     'Freezer High Temp', 'duration', 'temperature', 'gt', -15.0, 600,
     '["email", "sms"]'),
    -- Loading dock: alert if temp > 10°C (instant, no duration)
    ('c0000000-0000-0000-0000-000000000001',
     'd0000000-0000-0000-0000-000000000004',
     'Loading Dock High Temp', 'threshold', 'temperature', 'gt', 10.0, 0,
     '["email"]'),
    -- System-wide connectivity alert
    ('c0000000-0000-0000-0000-000000000001',
     NULL,
     'Sensor Offline', 'connectivity', 'temperature', 'gt', 0, 0,
     '["email"]')
ON CONFLICT DO NOTHING;
