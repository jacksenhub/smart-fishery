"use client";

import { AdaptiveDpr, Bounds, Line as DreiLine, OrbitControls, useGLTF, useProgress } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { memo, Suspense, useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import * as THREE from "three";

interface BoatTwinSceneProps {
  compact?: boolean;
  showGrid?: boolean;
  showOcean?: boolean;
  liveOcean?: boolean;
  hero?: boolean;
  colorizeModel?: boolean;
  autoRotate?: boolean;
  float?: boolean;
  showEdges?: boolean;
  pauseAutoRotateOnInteract?: boolean;
  viewMode?: "follow" | "top" | "front";
  demoCommand?: BoatDemoCommand;
  deviceFeedback?: BoatDeviceFeedback;
  simulationPreview?: BoatSimulationPreview;
}

export interface BoatDeviceFeedback {
  servoAngles: Array<number | null>;
  servoBoardOnline: boolean[];
  motorPower: number;
  motorOnline: boolean;
}

export interface BoatSimulationPreview {
  active: boolean;
  risk: "low" | "medium" | "high";
}

type BoatDemoCommand = {
  type: "pause" | "return" | "next" | "reset";
  nonce: number;
};

const MODEL_URL = "/models/inspection-boat.glb";
const MODEL_COLORS = {
  hull: "#087582",
  deck: "#d8e5e8",
  cabin: "#f2eee3",
  hardware: "#263445",
} as const;

const DEMO_ROUTE: Array<[number, number, number]> = [
  [-3.35, -0.34, -1.9],
  [-1.72, -0.34, -0.92],
  [-0.08, -0.34, -0.08],
  [1.55, -0.34, 0.78],
  [3.28, -0.34, 1.82],
];

const PREDICTION_ROUTE: Array<[number, number, number]> = [
  [-0.92, -0.3, -0.46],
  [-0.5, -0.3, -0.24],
  [-0.08, -0.3, -0.04],
  [0.38, -0.3, 0.24],
  [0.86, -0.3, 0.48],
];

const WATER_VERTEX_SHADER = `
  uniform float uTime;
  varying vec2 vUv;
  varying float vWave;

  void main() {
    vUv = uv;
    vec3 nextPosition = position;
    float wave = sin(nextPosition.x * 0.82 + uTime * 0.62) * 0.026;
    wave += cos(nextPosition.y * 1.05 - uTime * 0.48) * 0.018;
    wave += sin((nextPosition.x + nextPosition.y) * 1.7 + uTime * 0.72) * 0.009;
    nextPosition.z += wave;
    vWave = wave;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(nextPosition, 1.0);
  }
`;

const WATER_FRAGMENT_SHADER = `
  uniform float uTime;
  varying vec2 vUv;
  varying float vWave;

  void main() {
    vec3 shallow = vec3(0.86, 0.97, 0.98);
    vec3 clearBlue = vec3(0.50, 0.81, 0.87);
    float depthMix = smoothstep(0.0, 1.0, vUv.y * 0.72 + 0.12);
    float rippleA = sin((vUv.x * 28.0 + vUv.y * 17.0) + uTime * 0.42);
    float rippleB = cos((vUv.x * 13.0 - vUv.y * 31.0) - uTime * 0.31);
    float ripple = rippleA * 0.58 + rippleB * 0.42;
    float highlight = smoothstep(0.72, 0.98, ripple) * 0.075 + vWave * 0.9;
    vec3 color = mix(shallow, clearBlue, depthMix * 0.48);
    color += vec3(highlight);
    gl_FragColor = vec4(color, 0.3);
  }
`;

function SceneTicker({ active, fps = 30 }: { active: boolean; fps?: number }) {
  const { invalidate } = useThree();

  useEffect(() => {
    if (!active) return;

    let frameId = 0;
    let previous = 0;
    const frameInterval = 1000 / fps;

    const tick = (time: number) => {
      if (time - previous >= frameInterval) {
        previous = time;
        invalidate();
      }
      frameId = window.requestAnimationFrame(tick);
    };

    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, [active, fps, invalidate]);

  return null;
}

function VesselRig({
  compact = false,
  modelAvailable,
  colorizeModel,
  float,
  showEdges,
  demoCommand,
  demoMotion,
  deviceFeedback,
}: {
  compact?: boolean;
  modelAvailable: boolean | null;
  colorizeModel: boolean;
  float: boolean;
  showEdges: boolean;
  demoCommand?: BoatDemoCommand;
  demoMotion: boolean;
  deviceFeedback?: BoatDeviceFeedback;
}) {
  const group = useRef<THREE.Group>(null);
  const progressRef = useRef(0.48);
  const targetProgressRef = useRef(0.48);
  const pulseRef = useRef(0);
  const pausedRef = useRef(false);

  useEffect(() => {
    if (!demoCommand?.nonce) return;

    pulseRef.current = 1;

    if (demoCommand.type === "pause") {
      pausedRef.current = !pausedRef.current;
      targetProgressRef.current = progressRef.current;
      return;
    }

    pausedRef.current = false;

    if (demoCommand.type === "return") {
      targetProgressRef.current = 0.05;
      return;
    }

    if (demoCommand.type === "reset") {
      targetProgressRef.current = 0.48;
      return;
    }

    const next = progressRef.current + 0.22;
    targetProgressRef.current = next > 0.94 ? 0.18 : next;
  }, [demoCommand?.nonce, demoCommand?.type]);

  useFrame((state, deltaTime) => {
    if (!group.current) return;

    if (demoMotion && !pausedRef.current) {
      const delta = targetProgressRef.current - progressRef.current;
      if (Math.abs(delta) > 0.0015) {
        progressRef.current += delta * Math.min(1, deltaTime * 2.2);
      }
    }

    const baseScale = compact ? 0.78 : 1;
    const pulse = pulseRef.current;

    pulseRef.current = Math.max(0, pulse * 0.92 - 0.004);
    if (demoMotion) {
      const current = getRoutePoint(progressRef.current);
      const next = getRoutePoint(Math.min(1, progressRef.current + 0.012));
      group.current.position.x = current[0];
      group.current.position.z = current[2];
      group.current.rotation.y = Math.atan2(next[0] - current[0], next[2] - current[2]);
    } else {
      group.current.position.x = 0;
      group.current.position.z = 0;
      group.current.rotation.y = 0;
    }
    group.current.position.y = float ? Math.sin(state.clock.elapsedTime * 1.2) * 0.04 : 0;
    group.current.scale.setScalar(baseScale * (1 + pulse * 0.045));
  });

  return (
    <group ref={group} scale={compact ? 0.78 : 1}>
      {modelAvailable === null ? null : modelAvailable ? <LoadedVessel colorizeModel={colorizeModel} showEdges={showEdges} /> : <ProceduralVessel />}
      {deviceFeedback ? <DeviceFeedbackRig feedback={deviceFeedback} importedModel={modelAvailable === true} /> : null}
      {demoMotion && <WakeTrail pausedRef={pausedRef} />}
    </group>
  );
}

function DeviceFeedbackRig({ feedback, importedModel }: { feedback: BoatDeviceFeedback; importedModel: boolean }) {
  const servoPositions: Array<[number, number, number]> = importedModel
    ? [
        [-0.32, 0.24, 0.16],
        [-0.1, 0.24, 0.16],
        [0.12, 0.24, 0.16],
        [0.34, 0.24, 0.16],
        [-0.32, 0.24, 0.46],
        [-0.1, 0.24, 0.46],
        [0.12, 0.24, 0.46],
        [0.34, 0.24, 0.46],
      ]
    : [
        [-1.5, 0.48, -0.42],
        [-0.5, 0.48, -0.42],
        [0.5, 0.48, -0.42],
        [1.5, 0.48, -0.42],
        [-1.5, 0.48, 0.42],
        [-0.5, 0.48, 0.42],
        [0.5, 0.48, 0.42],
        [1.5, 0.48, 0.42],
      ];
  const rigPosition: [number, number, number] = importedModel ? [0, -0.32, 0] : [0, 0, 0];
  const rigRotation: [number, number, number] = importedModel ? [0, Math.PI, 0] : [0, 0, 0];

  return (
    <group position={rigPosition} rotation={rigRotation}>
      {servoPositions.map((position, index) => (
        <ServoFeedbackArm
          key={index}
          position={position}
          angle={feedback.servoAngles[index] ?? null}
          online={feedback.servoBoardOnline[Math.floor(index / 4)] ?? false}
          size={importedModel ? 0.13 : 0.38}
        />
      ))}
      <MotorFeedback
        position={importedModel ? [-0.4, 0.13, 0.34] : [-2, 0.05, 0]}
        power={feedback.motorPower}
        online={feedback.motorOnline}
        size={importedModel ? 0.12 : 0.34}
      />
    </group>
  );
}

function ServoFeedbackArm({
  position,
  angle,
  online,
  size,
}: {
  position: [number, number, number];
  angle: number | null;
  online: boolean;
  size: number;
}) {
  const hasFeedback = online && angle !== null;
  const rotation = THREE.MathUtils.degToRad((angle ?? 90) - 90);
  const color = hasFeedback ? "#06b6d4" : "#64748b";

  return (
    <group position={position}>
      <mesh>
        <cylinderGeometry args={[size * 0.18, size * 0.22, size * 0.16, 16]} />
        <meshStandardMaterial color={hasFeedback ? "#d5f4f7" : "#94a3b8"} roughness={0.5} />
      </mesh>
      <group rotation={[0, rotation, 0]}>
        <mesh position={[size * 0.5, size * 0.12, 0]}>
          <boxGeometry args={[size, size * 0.16, size * 0.22]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={hasFeedback ? 0.18 : 0} roughness={0.42} />
        </mesh>
      </group>
    </group>
  );
}

function MotorFeedback({ position, power, online, size }: { position: [number, number, number]; power: number; online: boolean; size: number }) {
  const rotorRef = useRef<THREE.Group>(null);

  useFrame((_state, deltaTime) => {
    if (!rotorRef.current || !online || Math.abs(power) <= 4) return;
    rotorRef.current.rotation.z += deltaTime * THREE.MathUtils.clamp(power / 35, -1, 1) * 10;
  });

  const active = online && Math.abs(power) > 4;
  const color = active ? (power > 0 ? "#10b981" : "#f59e0b") : "#64748b";

  return (
    <group position={position}>
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[size * 0.48, size * 0.48, size, 20]} />
        <meshStandardMaterial color={online ? "#334155" : "#64748b"} roughness={0.48} metalness={0.18} />
      </mesh>
      <group ref={rotorRef} position={[size * 0.62, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
        {[0, Math.PI / 2].map((rotation) => (
          <mesh key={rotation} rotation={[0, 0, rotation]}>
            <boxGeometry args={[size * 0.16, size * 1.05, size * 0.08]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={active ? 0.26 : 0} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

function WakeTrail({ pausedRef }: { pausedRef: MutableRefObject<boolean> }) {
  const materialRef = useRef<THREE.PointsMaterial>(null);
  const positions = useMemo(() => {
    const points: number[] = [];
    for (let index = 0; index < 34; index += 1) {
      const distance = 0.64 + index * 0.115;
      const side = index % 2 === 0 ? -1 : 1;
      points.push(side * (0.12 + distance * 0.075), -0.37 + Math.sin(index * 0.7) * 0.01, -distance);
    }
    return new Float32Array(points);
  }, []);

  useFrame((state) => {
    if (!materialRef.current) return;
    const baseOpacity = pausedRef.current ? 0.04 : 0.3;
    materialRef.current.opacity = baseOpacity + Math.sin(state.clock.elapsedTime * 2.1) * 0.035;
  });

  return (
    <points renderOrder={4}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial ref={materialRef} color="#ffffff" size={0.09} sizeAttenuation transparent opacity={0.3} depthWrite={false} />
    </points>
  );
}

function LoadedVessel({ colorizeModel, showEdges }: { colorizeModel: boolean; showEdges: boolean }) {
  const { scene } = useGLTF(MODEL_URL);
  const model = useMemo(() => prepareImportedModel(scene, colorizeModel, showEdges), [scene, colorizeModel, showEdges]);

  return (
    <primitive
      object={model}
      position={[0, -0.32, 0]}
      rotation={[0, Math.PI, 0]}
      scale={1}
    />
  );
}

function prepareImportedModel(scene: THREE.Group, colorizeModel: boolean, showEdges: boolean) {
  const model = scene.clone(true);
  model.updateMatrixWorld(true);
  const sceneBounds = new THREE.Box3().setFromObject(model);
  let meshIndex = 0;

  model.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;

    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.material = enhanceMaterial(mesh, sceneBounds, meshIndex, colorizeModel);
    if (showEdges && colorizeModel && shouldAddEdgeOverlay(mesh)) {
      mesh.add(createEdgeOverlay(mesh, sceneBounds));
    }
    meshIndex += 1;
  });

  return model;
}

function enhanceMaterial(mesh: THREE.Mesh, sceneBounds: THREE.Box3, index: number, colorizeModel: boolean) {
  const roleColor = colorizeModel ? chooseModelColor(mesh, sceneBounds, index) : null;
  if (Array.isArray(mesh.material)) {
    return mesh.material.map((material) => enhanceSingleMaterial(material, roleColor));
  }

  return enhanceSingleMaterial(mesh.material, roleColor);
}

function enhanceSingleMaterial(original: THREE.Material, roleColor: string | null) {
  const originalStandard = original instanceof THREE.MeshStandardMaterial ? original : null;
  const material = new THREE.MeshStandardMaterial({
    map: originalStandard?.map || null,
    normalMap: originalStandard?.normalMap || null,
    roughnessMap: originalStandard?.roughnessMap || null,
    metalnessMap: originalStandard?.metalnessMap || null,
    color: originalStandard?.color || new THREE.Color("#f4f7f8"),
    roughness: 0.82,
    metalness: 0.02,
  });

  if (originalStandard?.map) {
    material.roughness = 0.74;
    material.metalness = Math.min(0.12, originalStandard.metalness || 0.04);
  }

  if (roleColor) {
    material.color.set(roleColor);
    material.roughness = getRoleRoughness(roleColor);
    material.metalness = getRoleMetalness(roleColor);
  }

  material.envMapIntensity = 0.24;
  material.needsUpdate = true;
  return material;
}

function getRoleRoughness(color: string) {
  if (color === MODEL_COLORS.hull) return 0.58;
  if (color === MODEL_COLORS.hardware) return 0.68;
  return 0.76;
}

function getRoleMetalness(color: string) {
  if (color === MODEL_COLORS.hardware) return 0.14;
  if (color === MODEL_COLORS.hull) return 0.04;
  return 0.02;
}

function chooseModelColor(mesh: THREE.Mesh, sceneBounds: THREE.Box3, _index: number) {
  const name = mesh.name.toLowerCase();
  const box = new THREE.Box3().setFromObject(mesh);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const sceneSize = sceneBounds.getSize(new THREE.Vector3());
  const yRatio = sceneSize.y === 0 ? 0.5 : (center.y - sceneBounds.min.y) / sceneSize.y;
  const relativeVolume = (size.x * size.y * size.z) / Math.max(0.0001, sceneSize.x * sceneSize.y * sceneSize.z);
  const thinPart = Math.min(size.x, size.y, size.z) < Math.max(sceneSize.y * 0.035, 0.015);

  if (/rail|pipe|motor|servo|prop|shaft|axis|wheel|arm|bracket|screw|bolt|rod|link|cylinder/.test(name) || relativeVolume < 0.004) {
    return MODEL_COLORS.hardware;
  }
  if (/hull|body|boat|ship|bottom|float|pontoon/.test(name) || yRatio < 0.38) {
    return MODEL_COLORS.hull;
  }
  if (/deck|floor|platform|panel/.test(name)) {
    return MODEL_COLORS.deck;
  }
  if (/cabin|box|house|cover|lid|top/.test(name) || yRatio > 0.62) {
    return MODEL_COLORS.cabin;
  }

  if (thinPart) return MODEL_COLORS.hardware;
  if (yRatio < 0.48) return MODEL_COLORS.hull;
  if (yRatio < 0.62) return MODEL_COLORS.deck;
  return MODEL_COLORS.cabin;
}

function shouldAddEdgeOverlay(mesh: THREE.Mesh) {
  const position = mesh.geometry?.attributes?.position;
  return Boolean(position && position.count <= 120_000);
}

function createEdgeOverlay(mesh: THREE.Mesh, sceneBounds: THREE.Box3) {
  const box = new THREE.Box3().setFromObject(mesh);
  const center = box.getCenter(new THREE.Vector3());
  const sceneSize = sceneBounds.getSize(new THREE.Vector3());
  const yRatio = sceneSize.y === 0 ? 0.5 : (center.y - sceneBounds.min.y) / sceneSize.y;
  const color = yRatio < 0.42 ? "#064951" : "#44515f";
  const edges = new THREE.EdgesGeometry(mesh.geometry, 38);
  const lines = new THREE.LineSegments(
    edges,
    new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: yRatio < 0.42 ? 0.2 : 0.16,
      depthTest: true,
      depthWrite: false,
    }),
  );
  lines.renderOrder = 2;
  return lines;
}

function ProceduralVessel() {
  return (
    <>
      <mesh position={[0, -0.12, 0]}>
        <boxGeometry args={[4.8, 0.48, 1.18]} />
        <meshStandardMaterial color="#0c9ab0" metalness={0.42} roughness={0.34} />
      </mesh>
      <mesh position={[2.55, -0.1, 0]} rotation={[0, 0, Math.PI / 2]}>
        <coneGeometry args={[0.62, 1.1, 4]} />
        <meshStandardMaterial color="#32e7ff" metalness={0.42} roughness={0.26} />
      </mesh>
      <mesh position={[-2.4, -0.12, 0]} rotation={[0, 0, -Math.PI / 2]}>
        <coneGeometry args={[0.62, 0.88, 4]} />
        <meshStandardMaterial color="#0b5f83" metalness={0.4} roughness={0.28} />
      </mesh>
      <mesh position={[0, 0.22, 0]}>
        <boxGeometry args={[2.25, 0.48, 0.86]} />
        <meshStandardMaterial color="#e9fbff" emissive="#0a3440" emissiveIntensity={0.12} roughness={0.18} />
      </mesh>
      <mesh position={[0.74, 0.64, 0]}>
        <boxGeometry args={[0.9, 0.55, 0.68]} />
        <meshStandardMaterial color="#d5f9ff" emissive="#123d4b" emissiveIntensity={0.15} roughness={0.2} />
      </mesh>
      <mesh position={[-0.6, 0.58, 0]} rotation={[0, 0, 0.18]}>
        <boxGeometry args={[0.9, 0.06, 1.05]} />
        <meshStandardMaterial color="#46f4ff" emissive="#22ddff" emissiveIntensity={0.28} roughness={0.2} />
      </mesh>
      <mesh position={[-1.55, 0.32, 0.48]} rotation={[0.45, 0, 0]}>
        <cylinderGeometry args={[0.08, 0.08, 0.74, 12]} />
        <meshStandardMaterial color="#57ffd6" emissive="#57ffd6" emissiveIntensity={0.2} />
      </mesh>
      <mesh position={[-1.55, 0.32, -0.48]} rotation={[0.45, 0, 0]}>
        <cylinderGeometry args={[0.08, 0.08, 0.74, 12]} />
        <meshStandardMaterial color="#57ffd6" emissive="#57ffd6" emissiveIntensity={0.2} />
      </mesh>
      <mesh position={[1.65, 0.32, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 1.12, 12]} />
        <meshStandardMaterial color="#c8f8ff" />
      </mesh>
      <mesh position={[1.65, 0.94, 0]}>
        <sphereGeometry args={[0.13, 16, 16]} />
        <meshStandardMaterial color="#41f3ff" emissive="#41f3ff" emissiveIntensity={0.72} />
      </mesh>
    </>
  );
}

function OceanPlane({ animate = true }: { animate?: boolean }) {
  const waveMaterialRef = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), []);

  useFrame((state) => {
    if (!animate || !waveMaterialRef.current) return;
    waveMaterialRef.current.uniforms.uTime.value = state.clock.elapsedTime;
  });

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.45, 0]}>
        <planeGeometry args={[34, 34]} />
        <meshPhysicalMaterial
          color="#bfe8ef"
          roughness={0.42}
          metalness={0.02}
          clearcoat={0.58}
          clearcoatRoughness={0.34}
        />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.425, 0]} renderOrder={3}>
        <planeGeometry args={[34, 34, 36, 36]} />
        <shaderMaterial
          ref={waveMaterialRef}
          uniforms={uniforms}
          vertexShader={WATER_VERTEX_SHADER}
          fragmentShader={WATER_FRAGMENT_SHADER}
          transparent
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

function getRoutePoint(progress: number) {
  const clamped = THREE.MathUtils.clamp(progress, 0, 1);
  const scaled = clamped * (DEMO_ROUTE.length - 1);
  const index = Math.min(DEMO_ROUTE.length - 2, Math.floor(scaled));
  const localProgress = scaled - index;
  const start = DEMO_ROUTE[index];
  const end = DEMO_ROUTE[index + 1];

  return [
    THREE.MathUtils.lerp(start[0], end[0], localProgress),
    THREE.MathUtils.lerp(start[1], end[1], localProgress),
    THREE.MathUtils.lerp(start[2], end[2], localProgress),
  ] as [number, number, number];
}

function RouteLayer() {
  return (
    <group>
      <DreiLine points={DEMO_ROUTE} color="#0f7f8a" lineWidth={2.5} dashed dashScale={1} dashSize={0.28} gapSize={0.18} />
      {DEMO_ROUTE.map((point, index) => (
        <group key={`${point[0]}-${point[2]}`} position={point}>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.13, 0.2, 32]} />
            <meshBasicMaterial color={index === DEMO_ROUTE.length - 1 ? "#5f8f72" : "#1897a3"} transparent opacity={0.86} />
          </mesh>
          <mesh position={[0, 0.05, 0]}>
            <sphereGeometry args={[0.06, 16, 16]} />
            <meshBasicMaterial color={index === DEMO_ROUTE.length - 1 ? "#5f8f72" : "#1897a3"} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function PredictionRouteLayer({ risk }: { risk: BoatSimulationPreview["risk"] }) {
  const marker = useRef<THREE.Group>(null);
  const progress = useRef(0);
  const color = risk === "high" ? "#e11d48" : risk === "medium" ? "#d97706" : "#0891b2";

  useFrame((_state, delta) => {
    if (!marker.current) return;
    progress.current = (progress.current + delta * 0.055) % 1;
    const current = getPredictionRoutePoint(progress.current);
    const next = getPredictionRoutePoint(Math.min(1, progress.current + 0.015));
    marker.current.position.set(current[0], -0.285, current[2]);
    marker.current.rotation.y = Math.atan2(next[0] - current[0], next[2] - current[2]);
  });

  return (
    <group>
      <DreiLine points={PREDICTION_ROUTE} color={color} lineWidth={1.8} dashed dashScale={1.4} dashSize={0.06} gapSize={0.045} transparent opacity={0.78} />
      {PREDICTION_ROUTE.map((point, index) => (
        <mesh key={index} position={[point[0], -0.292, point[2]]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.018, 0.032, 20]} />
          <meshBasicMaterial color={color} transparent opacity={0.78} side={THREE.DoubleSide} />
        </mesh>
      ))}
      <group ref={marker}>
        <mesh position={[0, 0.025, 0]}>
          <boxGeometry args={[0.075, 0.024, 0.13]} />
          <meshStandardMaterial color={color} transparent opacity={0.72} emissive={color} emissiveIntensity={0.2} />
        </mesh>
        <mesh position={[0, 0.025, 0.085]} rotation={[Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.038, 0.07, 3]} />
          <meshStandardMaterial color={color} transparent opacity={0.72} emissive={color} emissiveIntensity={0.2} />
        </mesh>
      </group>
    </group>
  );
}

function getPredictionRoutePoint(progress: number) {
  const clamped = THREE.MathUtils.clamp(progress, 0, 1);
  const scaled = clamped * (PREDICTION_ROUTE.length - 1);
  const index = Math.min(PREDICTION_ROUTE.length - 2, Math.floor(scaled));
  const local = scaled - index;
  const start = PREDICTION_ROUTE[index];
  const end = PREDICTION_ROUTE[index + 1];
  return [
    THREE.MathUtils.lerp(start[0], end[0], local),
    THREE.MathUtils.lerp(start[1], end[1], local),
    THREE.MathUtils.lerp(start[2], end[2], local),
  ] as [number, number, number];
}

function PresentationShadow() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.48, 0]} scale={[3.8, 1.25, 1]}>
      <circleGeometry args={[1, 72]} />
      <meshBasicMaterial color="#172033" transparent opacity={0.1} depthWrite={false} />
    </mesh>
  );
}

function getCameraPosition({
  compact,
  hero,
  viewMode,
}: {
  compact: boolean;
  hero: boolean;
  viewMode: "follow" | "top" | "front";
}) {
  if (hero) return [7.2, 3.15, 7.6];
  if (viewMode === "top") return [0.2, 7.4, 0.2];
  if (viewMode === "front") return [0.2, 2.35, 6.5];
  return compact ? [4.2, 2.45, 4.9] : [4.45, 2.7, 5.25];
}

function CameraViewController({
  compact,
  hero,
  viewMode,
  controlsRef,
  onInteract,
}: {
  compact: boolean;
  hero: boolean;
  viewMode: "follow" | "top" | "front";
  controlsRef: MutableRefObject<OrbitControlsImpl | null>;
  onInteract?: () => void;
}) {
  const { camera, invalidate } = useThree();
  const animRef = useRef<{ active: boolean; to: THREE.Vector3 } | null>(null);

  useEffect(() => {
    const next = getCameraPosition({ compact, hero, viewMode });
    animRef.current = { active: true, to: new THREE.Vector3(next[0], next[1], next[2]) };
    onInteract?.();
    invalidate();
  }, [camera, compact, controlsRef, hero, invalidate, viewMode, onInteract]);

  useFrame((_state, delta) => {
    const anim = animRef.current;
    if (!anim?.active) return;
    camera.position.lerp(anim.to, Math.min(1, delta * 3.4));
    camera.lookAt(0, 0, 0);
    controlsRef.current?.target.set(0, 0, 0);
    controlsRef.current?.update();
    invalidate();
    if (camera.position.distanceTo(anim.to) < 0.01) {
      camera.position.copy(anim.to);
      anim.active = false;
    }
  });

  return null;
}

export const BoatTwinScene = memo(function BoatTwinScene({
  compact = false,
  showGrid = true,
  showOcean = true,
  liveOcean = true,
  hero = false,
  colorizeModel = true,
  autoRotate,
  float,
  showEdges = false,
  pauseAutoRotateOnInteract,
  viewMode = "follow",
  demoCommand,
  deviceFeedback,
  simulationPreview,
}: BoatTwinSceneProps) {
  const [modelAvailable, setModelAvailable] = useState<boolean | null>(null);
  const [autoRotatePaused, setAutoRotatePaused] = useState(false);
  const [demoActive, setDemoActive] = useState(false);
  const [documentVisible, setDocumentVisible] = useState(true);
  const [interacting, setInteracting] = useState(false);
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const calmTimer = useRef<number | null>(null);
  const shouldAutoRotate = autoRotate ?? !hero;
  const shouldPauseAutoRotateOnInteract = pauseAutoRotateOnInteract ?? hero;
  const activeAutoRotate = shouldAutoRotate && !autoRotatePaused;
  const shouldFloat = float ?? !hero;
  const cameraPosition = getCameraPosition({ compact, hero, viewMode });

  const markInteraction = useCallback(() => {
    setInteracting(true);
    if (calmTimer.current) {
      window.clearTimeout(calmTimer.current);
      calmTimer.current = null;
    }
  }, []);

  const scheduleCalm = useCallback(() => {
    if (calmTimer.current) window.clearTimeout(calmTimer.current);
    calmTimer.current = window.setTimeout(() => setInteracting(false), 6000);
  }, []);

  useEffect(() => {
    setAutoRotatePaused(false);
  }, [shouldAutoRotate]);

  useEffect(() => {
    markInteraction();
  }, [markInteraction]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const handleVisibility = () => setDocumentVisible(!document.hidden);
    handleVisibility();
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  useEffect(() => {
    if (!demoCommand?.nonce) return;

    setDemoActive(true);
    const timer = window.setTimeout(() => setDemoActive(false), demoCommand.type === "pause" ? 900 : 2600);
    return () => window.clearTimeout(timer);
  }, [demoCommand?.nonce, demoCommand?.type]);

  useEffect(() => {
    let cancelled = false;
    fetch(MODEL_URL, { method: "HEAD" })
      .then((response) => {
        if (!cancelled && response.ok) {
          setModelAvailable(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setModelAvailable(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => () => {
    if (calmTimer.current) window.clearTimeout(calmTimer.current);
  }, []);

  // Render-loop control: keep the canvas fully on-demand (frameloop="demand").
  // Continuous rendering only happens during genuine motion (auto-rotate, float,
  // demo, motor feedback) or while the user is interacting; otherwise the water
  // idles at a gentle 12fps and the GPU goes quiet when the tab is hidden or the
  // live-ocean animation is switched off.
  const motorActive = Math.abs(deviceFeedback?.motorPower ?? 0) > 4;
  const highMotion = activeAutoRotate || shouldFloat || demoActive || motorActive || Boolean(simulationPreview?.active);
  const active = highMotion || interacting || (liveOcean && documentVisible);
  const fps = highMotion || interacting ? 30 : 12;

  return (
    <div className="relative h-full w-full">
      <Canvas
        className="h-full w-full touch-none"
        camera={{ position: cameraPosition as [number, number, number], fov: hero ? 33 : 36, near: 0.03, far: 250 }}
        dpr={hero ? [0.82, 1.08] : [0.78, 1]}
        frameloop="demand"
        gl={{ antialias: true, powerPreference: "high-performance" }}
        performance={{ min: 0.5 }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.outputColorSpace = THREE.SRGBColorSpace;
        }}
      >
        <Suspense fallback={null}>
          <SceneTicker active={active} fps={fps} />
          <AdaptiveDpr pixelated={false} />
        {showOcean && <color attach="background" args={["#e8f7fa"]} />}
        {showOcean && <fog attach="fog" args={["#e8f7fa", 15, 34]} />}
        <CameraViewController compact={compact} hero={hero} viewMode={viewMode} controlsRef={controlsRef} onInteract={markInteraction} />
        <hemisphereLight args={["#ffffff", "#bcdde4", hero ? 1.35 : 1.08]} />
        <ambientLight intensity={hero ? 0.4 : 0.5} />
        <directionalLight position={[4.5, 6, 3.5]} intensity={hero ? 2.05 : 1.42} color="#fffdf7" />
        <directionalLight position={[-4, 3, -3]} intensity={hero ? 0.82 : 0.62} color="#d9f3f7" />
        <pointLight position={[0, 2.1, 4.2]} intensity={hero ? 0.5 : 0.3} color="#ffffff" />
        <Bounds fit margin={hero ? 0.72 : 0.78}>
          <VesselRig
            compact={compact}
            modelAvailable={modelAvailable}
            colorizeModel={colorizeModel}
            float={shouldFloat}
            showEdges={showEdges}
            demoCommand={demoCommand}
            demoMotion={!hero && Boolean(demoCommand?.nonce)}
            deviceFeedback={deviceFeedback}
          />
        </Bounds>
        {hero && <PresentationShadow />}
        {showOcean && <OceanPlane animate={liveOcean} />}
        {showOcean && !hero && demoCommand?.nonce ? <RouteLayer /> : null}
        {showOcean && !hero && simulationPreview?.active ? <PredictionRouteLayer risk={simulationPreview.risk} /> : null}
        {showGrid && <gridHelper args={[22, 24, "#cddde4", "#edf3f6"]} position={[0, -0.39, 0]} />}
        <OrbitControls
          ref={controlsRef}
          makeDefault
          enableDamping
          dampingFactor={hero ? 0.11 : 0.1}
          enablePan
          enableZoom
          autoRotate={activeAutoRotate}
          autoRotateSpeed={hero ? 0.68 : 0.28}
          rotateSpeed={hero ? 0.52 : 0.55}
          minDistance={hero ? 0.55 : 0.62}
          maxDistance={hero ? 42 : 18}
          zoomSpeed={hero ? 0.78 : 0.72}
          panSpeed={hero ? 0.64 : 0.62}
          onStart={() => {
            markInteraction();
            if (shouldPauseAutoRotateOnInteract) {
              setAutoRotatePaused(true);
            }
          }}
          onEnd={() => {
            scheduleCalm();
          }}
        />
      </Suspense>
      </Canvas>
      <SceneLoaderOverlay />
    </div>
  );
});

function SceneLoaderOverlay() {
  const { active, progress } = useProgress();
  if (!active) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-harbor-100 bg-white/85 px-5 py-4 shadow-[0_12px_35px_rgba(42,91,109,0.12)] backdrop-blur-md">
        <span className="h-7 w-7 animate-spin rounded-full border-2 border-harbor-500 border-t-transparent" />
        <span className="text-xs font-semibold text-ink-500">模型加载中 {Math.round(progress)}%</span>
      </div>
    </div>
  );
}

useGLTF.preload(MODEL_URL);
