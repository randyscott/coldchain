#!/bin/bash
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE EXTENSION IF NOT EXISTS timescaledb;
    CREATE USER chirpstack WITH PASSWORD 'chirpstack_dev_password';
    CREATE DATABASE chirpstack OWNER chirpstack;
    \c chirpstack
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
    \c $POSTGRES_DB
    CREATE USER keycloak WITH PASSWORD 'keycloak_dev_password';
    CREATE DATABASE keycloak OWNER keycloak;
EOSQL

echo "ChirpStack and Keycloak databases initialized."
