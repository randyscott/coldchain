"""
ChirpStack gRPC Client
======================

Wraps the ChirpStack v4 gRPC API for the operations coldchain needs:
  - Application (system) create / delete
  - Device profile list (for sensor registration)
  - Device (sensor) create / update / delete / set OTAA keys
  - Gateway create / update / delete

All methods raise ChirpStackError on failure.

Usage:
    async with get_chirpstack_client() as cs:
        app_id = await cs.create_application("Warehouse A")
        await cs.create_device(app_id, dev_eui="aabbccddeeff0011", ...)

The client is stateless — a new channel is opened each time the context
manager is entered, which is fine for low-frequency management operations.
For high-throughput work the channel should be reused; that is not needed here.
"""

import logging
from contextlib import asynccontextmanager
from dataclasses import dataclass

import grpc
from chirpstack_api import api as cs_api
from chirpstack_api.common import common_pb2

from app.core.config import settings

logger = logging.getLogger(__name__)


class ChirpStackError(Exception):
    """Raised when a ChirpStack gRPC call fails."""
    pass


def _metadata() -> list[tuple[str, str]]:
    """gRPC call metadata carrying the API token."""
    return [("authorization", f"Bearer {settings.chirpstack_api_token}")]


@dataclass
class DeviceProfileSummary:
    id: str
    name: str
    description: str = ""
    region: str = ""
    mac_version: str = ""
    reg_params_revision: str = ""
    supports_otaa: bool = True
    supports_class_b: bool = False
    supports_class_c: bool = False


@asynccontextmanager
async def get_chirpstack_client():
    """Async context manager that yields a ChirpStackClient with an open gRPC channel."""
    channel = grpc.aio.insecure_channel(settings.chirpstack_api_url)
    client = ChirpStackClient(channel)
    try:
        yield client
    finally:
        await channel.close()


class ChirpStackClient:
    """
    Thin async wrapper around the ChirpStack v4 gRPC service stubs.
    All public methods translate gRPC errors into ChirpStackError.
    """

    def __init__(self, channel: grpc.aio.Channel):
        self._channel = channel
        self._app_stub = cs_api.ApplicationServiceStub(channel)
        self._device_stub = cs_api.DeviceServiceStub(channel)
        self._device_profile_stub = cs_api.DeviceProfileServiceStub(channel)
        self._gateway_stub = cs_api.GatewayServiceStub(channel)

    # =========================================================================
    # Applications (map 1:1 to coldchain systems)
    # =========================================================================

    async def create_application(self, name: str, description: str = "") -> str:
        """
        Create a ChirpStack application for a coldchain system.
        Returns the new application ID (string UUID).
        """
        req = cs_api.CreateApplicationRequest(
            application=cs_api.Application(
                tenant_id=settings.chirpstack_tenant_id,
                name=name,
                description=description or "",
            )
        )
        try:
            resp = await self._app_stub.Create(req, metadata=_metadata())
            logger.info(f"ChirpStack: created application '{name}' → {resp.id}")
            return resp.id
        except grpc.RpcError as e:
            raise ChirpStackError(f"Failed to create application '{name}': {e.details()}") from e

    async def update_application(self, cs_app_id: str, name: str, description: str = "") -> None:
        """Update an existing ChirpStack application's name/description."""
        req = cs_api.UpdateApplicationRequest(
            application=cs_api.Application(
                id=cs_app_id,
                tenant_id=settings.chirpstack_tenant_id,
                name=name,
                description=description or "",
            )
        )
        try:
            await self._app_stub.Update(req, metadata=_metadata())
            logger.info(f"ChirpStack: updated application {cs_app_id}")
        except grpc.RpcError as e:
            raise ChirpStackError(f"Failed to update application {cs_app_id}: {e.details()}") from e

    async def delete_application(self, cs_app_id: str) -> None:
        """Delete a ChirpStack application. Raises ChirpStackError if not found."""
        req = cs_api.DeleteApplicationRequest(id=cs_app_id)
        try:
            await self._app_stub.Delete(req, metadata=_metadata())
            logger.info(f"ChirpStack: deleted application {cs_app_id}")
        except grpc.RpcError as e:
            raise ChirpStackError(f"Failed to delete application {cs_app_id}: {e.details()}") from e

    # =========================================================================
    # Device Profiles
    # =========================================================================

    async def list_device_profiles(self) -> list[DeviceProfileSummary]:
        """
        Return all device profiles available in the tenant.
        Used to populate the device registration form.
        """
        req = cs_api.ListDeviceProfilesRequest(
            tenant_id=settings.chirpstack_tenant_id,
            limit=100,
        )
        try:
            resp = await self._device_profile_stub.List(req, metadata=_metadata())
            return [
                DeviceProfileSummary(
                    id=item.id,
                    name=item.name,
                    description="",  # not present in ListItem proto, only in full DeviceProfile
                    region=common_pb2.Region.Name(item.region),
                    mac_version=common_pb2.MacVersion.Name(item.mac_version),
                    reg_params_revision=common_pb2.RegParamsRevision.Name(item.reg_params_revision),
                    supports_otaa=item.supports_otaa,
                    supports_class_b=item.supports_class_b,
                    supports_class_c=item.supports_class_c,
                )
                for item in resp.result
            ]
        except grpc.RpcError as e:
            raise ChirpStackError(f"Failed to list device profiles: {e.details()}") from e

    async def create_device_profile(
        self,
        name: str,
        region: str,
        mac_version: str,
        reg_params_revision: str,
        description: str = "",
        supports_otaa: bool = True,
        supports_class_b: bool = False,
        supports_class_c: bool = False,
        uplink_interval: int = 3600,
        flush_queue_on_activate: bool = True,
        device_status_req_interval: int = 1,
        adr_algorithm_id: str = "default",
    ) -> str:
        """
        Create a device profile in ChirpStack.
        region / mac_version / reg_params_revision are string enum names
        (e.g. "EU868", "LORAWAN_1_0_3", "RP002_1_0_3").
        Returns the new profile ID.
        """
        req = cs_api.CreateDeviceProfileRequest(
            device_profile=cs_api.DeviceProfile(
                tenant_id=settings.chirpstack_tenant_id,
                name=name,
                description=description or "",
                region=common_pb2.Region.Value(region),
                mac_version=common_pb2.MacVersion.Value(mac_version),
                reg_params_revision=common_pb2.RegParamsRevision.Value(reg_params_revision),
                supports_otaa=supports_otaa,
                supports_class_b=supports_class_b,
                supports_class_c=supports_class_c,
                uplink_interval=uplink_interval,
                flush_queue_on_activate=flush_queue_on_activate,
                device_status_req_interval=device_status_req_interval,
                adr_algorithm_id=adr_algorithm_id,
            )
        )
        try:
            resp = await self._device_profile_stub.Create(req, metadata=_metadata())
            logger.info(f"ChirpStack: created device profile '{name}' → {resp.id}")
            return resp.id
        except grpc.RpcError as e:
            raise ChirpStackError(f"Failed to create device profile '{name}': {e.details()}") from e

    async def delete_device_profile(self, profile_id: str) -> None:
        """Delete a device profile. Raises ChirpStackError if not found."""
        req = cs_api.DeleteDeviceProfileRequest(id=profile_id)
        try:
            await self._device_profile_stub.Delete(req, metadata=_metadata())
            logger.info(f"ChirpStack: deleted device profile {profile_id}")
        except grpc.RpcError as e:
            raise ChirpStackError(f"Failed to delete device profile {profile_id}: {e.details()}") from e

    # =========================================================================
    # Devices (sensors)
    # =========================================================================

    async def create_device(
        self,
        cs_app_id: str,
        dev_eui: str,
        name: str,
        device_profile_id: str,
        description: str = "",
        join_eui: str = "",
        skip_fcnt_check: bool = False,
    ) -> None:
        """
        Register a sensor device in ChirpStack.
        dev_eui must be exactly 16 hex characters (no colons/dashes).
        join_eui (AppEUI) is optional but recommended for OTAA; pass as 16 hex chars.
        """
        req = cs_api.CreateDeviceRequest(
            device=cs_api.Device(
                application_id=cs_app_id,
                dev_eui=dev_eui.lower(),
                name=name,
                description=description or "",
                device_profile_id=device_profile_id,
                join_eui=join_eui.lower() if join_eui else "",
                skip_fcnt_check=skip_fcnt_check,
            )
        )
        try:
            await self._device_stub.Create(req, metadata=_metadata())
            logger.info(f"ChirpStack: registered device {dev_eui} ('{name}')")
        except grpc.RpcError as e:
            raise ChirpStackError(f"Failed to create device {dev_eui}: {e.details()}") from e

    async def set_device_otaa_keys(self, dev_eui: str, app_key: str) -> None:
        """
        Set the OTAA AppKey for a device.
        app_key must be a 32-character hex string (128-bit).
        """
        req = cs_api.CreateDeviceKeysRequest(
            device_keys=cs_api.DeviceKeys(
                dev_eui=dev_eui.lower(),
                nwk_key=app_key,  # ChirpStack uses nwk_key as the single key for LoRaWAN 1.0.x
                app_key=app_key,
            )
        )
        try:
            await self._device_stub.CreateKeys(req, metadata=_metadata())
            logger.info(f"ChirpStack: set OTAA keys for {dev_eui}")
        except grpc.RpcError as e:
            raise ChirpStackError(f"Failed to set OTAA keys for {dev_eui}: {e.details()}") from e

    async def update_device(
        self,
        cs_app_id: str,
        dev_eui: str,
        name: str,
        device_profile_id: str,
        description: str = "",
    ) -> None:
        """Update a device's name/description in ChirpStack."""
        req = cs_api.UpdateDeviceRequest(
            device=cs_api.Device(
                application_id=cs_app_id,
                dev_eui=dev_eui.lower(),
                name=name,
                description=description or "",
                device_profile_id=device_profile_id,
            )
        )
        try:
            await self._device_stub.Update(req, metadata=_metadata())
            logger.info(f"ChirpStack: updated device {dev_eui}")
        except grpc.RpcError as e:
            raise ChirpStackError(f"Failed to update device {dev_eui}: {e.details()}") from e

    async def delete_device(self, dev_eui: str) -> None:
        """Remove a device from ChirpStack."""
        req = cs_api.DeleteDeviceRequest(dev_eui=dev_eui.lower())
        try:
            await self._device_stub.Delete(req, metadata=_metadata())
            logger.info(f"ChirpStack: deleted device {dev_eui}")
        except grpc.RpcError as e:
            raise ChirpStackError(f"Failed to delete device {dev_eui}: {e.details()}") from e

    # =========================================================================
    # Gateways
    # =========================================================================

    async def create_gateway(
        self,
        gateway_id: str,
        name: str,
        description: str = "",
        location_lat: float | None = None,
        location_lon: float | None = None,
        location_alt: float = 0.0,
    ) -> None:
        """
        Register a gateway in ChirpStack.
        gateway_id must be a 16-character hex string (64-bit EUI).
        """
        location = cs_api.common.Location(
            latitude=location_lat or 0.0,
            longitude=location_lon or 0.0,
            altitude=location_alt,
            source=cs_api.common.LocationSource.UNKNOWN,
        )
        req = cs_api.CreateGatewayRequest(
            gateway=cs_api.Gateway(
                gateway_id=gateway_id.lower(),
                name=name,
                description=description or "",
                tenant_id=settings.chirpstack_tenant_id,
                location=location,
            )
        )
        try:
            await self._gateway_stub.Create(req, metadata=_metadata())
            logger.info(f"ChirpStack: registered gateway {gateway_id} ('{name}')")
        except grpc.RpcError as e:
            raise ChirpStackError(f"Failed to create gateway {gateway_id}: {e.details()}") from e

    async def update_gateway(
        self,
        gateway_id: str,
        name: str,
        description: str = "",
        location_lat: float | None = None,
        location_lon: float | None = None,
        location_alt: float = 0.0,
    ) -> None:
        """Update a gateway's name, description, or location in ChirpStack."""
        location = cs_api.common.Location(
            latitude=location_lat or 0.0,
            longitude=location_lon or 0.0,
            altitude=location_alt,
            source=cs_api.common.LocationSource.UNKNOWN,
        )
        req = cs_api.UpdateGatewayRequest(
            gateway=cs_api.Gateway(
                gateway_id=gateway_id.lower(),
                name=name,
                description=description or "",
                tenant_id=settings.chirpstack_tenant_id,
                location=location,
            )
        )
        try:
            await self._gateway_stub.Update(req, metadata=_metadata())
            logger.info(f"ChirpStack: updated gateway {gateway_id}")
        except grpc.RpcError as e:
            raise ChirpStackError(f"Failed to update gateway {gateway_id}: {e.details()}") from e

    async def delete_gateway(self, gateway_id: str) -> None:
        """Remove a gateway from ChirpStack."""
        req = cs_api.DeleteGatewayRequest(gateway_id=gateway_id.lower())
        try:
            await self._gateway_stub.Delete(req, metadata=_metadata())
            logger.info(f"ChirpStack: deleted gateway {gateway_id}")
        except grpc.RpcError as e:
            raise ChirpStackError(f"Failed to delete gateway {gateway_id}: {e.details()}") from e
