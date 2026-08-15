"use client";

import type { NavigationData } from "@fishery/shared";
import L from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";
import { ImageOverlay, MapContainer, Marker, Polyline, ScaleControl, TileLayer, Tooltip } from "react-leaflet";
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
  const [tileFailed, setTileFailed] = useState(false);
  const route = useMemo(
    () => navigation.route.map((point) => [point.lat, point.lng] as [number, number]),
    [navigation.route],
  );
  const displayedRoute = useMemo(
    () => route.length > 1 ? [...route, route[0]] : route,
    [route],
  );
  const center = useMemo(
    () => [navigation.position.lat, navigation.position.lng] as [number, number],
    [navigation.position.lat, navigation.position.lng],
  );
  const liveGps = navigation.source === "gps";

  return (
    <MapContainer
      center={center}
      zoom={18}
      minZoom={15}
      maxZoom={19}
      scrollWheelZoom
      inertia={false}
      zoomAnimation={false}
      fadeAnimation={false}
      markerZoomAnimation={false}
      className="campus-map h-full w-full"
    >
      {tileFailed ? (
        <ImageOverlay
          url="/map/offline-basemap.svg"
          bounds={[[center[0] - 0.001, center[1] - 0.0015], [center[0] + 0.001, center[1] + 0.0015]]}
          opacity={1}
        />
      ) : (
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
          eventHandlers={{ tileerror: () => setTileFailed(true) }}
        />
      )}
      <ScaleControl position="bottomleft" imperial={false} />
      <FollowPosition position={center} enabled={liveGps} />
      {!liveGps && <FitRoute route={displayedRoute} />}
      {displayedRoute.length > 1 && (
        <Polyline positions={displayedRoute} pathOptions={{ color: "#0f7f8a", weight: 4, opacity: 0.82 }} />
      )}
      {navigation.route.map((point) => (
        <Marker key={`${point.lat}-${point.lng}`} position={[point.lat, point.lng]} icon={waypointIcon()}>
          <Tooltip>{point.label}</Tooltip>
        </Marker>
      ))}
      <Marker position={center} icon={vesselIcon()}>
        <Tooltip permanent direction="top">{navigation.position.label || "智慧渔业巡检船"}</Tooltip>
      </Marker>
    </MapContainer>
  );
}

function FitRoute({ route }: { route: Array<[number, number]> }) {
  const map = useMap();
  const lastRouteSignature = useRef("");

  useEffect(() => {
    if (!route.length) return;
    const routeSignature = route
      .map(([latitude, longitude]) => `${latitude.toFixed(7)},${longitude.toFixed(7)}`)
      .join("|");
    if (routeSignature === lastRouteSignature.current) return;
    lastRouteSignature.current = routeSignature;

    map.stop();
    map.fitBounds(route, {
      padding: [42, 42],
      maxZoom: 18,
      animate: false,
    });

    return () => {
      map.stop();
    };
  }, [map, route]);

  return null;
}

function FollowPosition({ position, enabled }: { position: [number, number]; enabled: boolean }) {
  const map = useMap();

  useEffect(() => {
    if (!enabled) return;

    const target = L.latLng(position[0], position[1]);
    const distance = map.distance(map.getCenter(), target);
    map.stop();
    if (distance > 1000) {
      map.setView(target, 18, { animate: false });
    } else {
      map.setView(target, map.getZoom(), { animate: false });
    }

    return () => {
      map.stop();
    };
  }, [enabled, map, position]);

  return null;
}
