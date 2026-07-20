"use client";

import type { NavigationData } from "@fishery/shared";
import L from "leaflet";
import { useEffect } from "react";
import { MapContainer, Marker, Polyline, Tooltip } from "react-leaflet";
import { useMap } from "react-leaflet";

function vesselIcon() {
  return L.divIcon({
    className: "",
    html: '<div style="width:18px;height:18px;border-radius:999px;background:#0f7f8a;box-shadow:0 0 0 6px rgba(15,127,138,.14);border:3px solid #ffffff"></div>',
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

function waypointIcon() {
  return L.divIcon({
    className: "",
    html: '<div style="width:12px;height:12px;border-radius:999px;background:#5f8f72;border:2px solid #ffffff"></div>',
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  });
}

export function NavigationMap({ navigation }: { navigation: NavigationData }) {
  const route = navigation.route.map((point) => [point.lat, point.lng] as [number, number]);
  const center = [navigation.position.lat, navigation.position.lng] as [number, number];

  return (
    <MapContainer center={center} zoom={15} minZoom={13} scrollWheelZoom className="ocean-map h-full w-full">
      <FitOceanRoute route={route} />
      <Polyline positions={route} pathOptions={{ color: "#0f7f8a", weight: 4, opacity: 0.72 }} />
      {navigation.route.map((point) => (
        <Marker key={`${point.lat}-${point.lng}`} position={[point.lat, point.lng]} icon={waypointIcon()}>
          <Tooltip>{point.label}</Tooltip>
        </Marker>
      ))}
      <Marker position={center} icon={vesselIcon()}>
        <Tooltip permanent direction="top">智慧渔业巡检船</Tooltip>
      </Marker>
    </MapContainer>
  );
}

function FitOceanRoute({ route }: { route: Array<[number, number]> }) {
  const map = useMap();

  useEffect(() => {
    if (!route.length) return;
    map.fitBounds(route, {
      padding: [42, 42],
      maxZoom: 15,
    });
  }, [map, route]);

  return null;
}
