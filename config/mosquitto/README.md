# Mosquitto Password File

Generate the password file before starting docker-compose:

```bash
# Install mosquitto-clients if needed
sudo apt install -y mosquitto-clients

# Generate password file
mosquitto_passwd -c -b config/mosquitto/password_file coldchain coldchain_dev
mosquitto_passwd -b config/mosquitto/password_file chirpstack chirpstack_mqtt_dev
```

The password_file is gitignored and must be generated locally.
