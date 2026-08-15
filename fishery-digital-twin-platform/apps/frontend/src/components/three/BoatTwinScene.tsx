"use client";

import { AdaptiveDpr, Bounds, Line as DreiLine, OrbitControls, useGLTF, useProgress } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { memo, Suspense, useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import * as THREE from "three";

interface BoatTwinSceneProps {
  modelUrl?: string;
  compact?: boolean;
  showGrid?: boolean;
  showOcean?: boolean;
  liveOcean?: boolean;
  hero?: boolean;
  colorizeModel?: boolean;
  colorizeLightMaterialsOnly?: boolean;
  autoRotate?: boolean;
  float?: boolean;
  showEdges?: boolean;
  pauseAutoRotateOnInteract?: boolean;
  viewMode?: "follow" | "top" | "front";
  demoCommand?: BoatDemoCommand;
  deviceFeedback?: BoatDeviceFeedback;
  simulationPreview?: BoatSimulationPreview;
  workSimulation?: boolean;
  showWorkEquipment?: boolean;
  showAquaculture?: boolean;
  vesselHeading?: number;
  vesselPosition?: [number, number];
  vesselScale?: number;
}

export interface BoatDeviceFeedback {
  servoAngles: Array<number | null>;
  servoBoardOnline: boolean[];
  motorPower: number;
  motorOnline: boolean;
  dualPushrodPower: [number, number];
  dualPushrodOnline: boolean;
  sxtlPower: number;
  sxtlOnline: boolean;
  sxtlRuntimeLockout: boolean;
  sxtlCooldownRemainingMs: number;
}

export interface BoatSimulationPreview {
  active: boolean;
  risk: "low" | "medium" | "high";
}

type BoatDemoCommand = {
  type: "pause" | "return" | "next" | "reset";
  nonce: number;
};

const DEFAULT_MODEL_URL = "/models/inspection-boat.glb";
const REFERENCE_MODEL_CENTER = new THREE.Vector3(0.075848803, 0.18168015015, 0.33534794475);
const REFERENCE_MODEL_LENGTH = 1.099523216;
const MODEL_COLORS = {
  hull: "#23677b",
  sideHull: "#2e8792",
  deck: "#dbe4e2",
  cabin: "#f2f0e8",
  hardware: "#2d3c47",
} as const;

const LIGHT_MATERIAL_COLORS = {
  hull: "#17677a",
  sideHull: "#2f8e95",
  deck: "#73aeb0",
  cabin: "#a8c8c6",
  hardware: "#2d3c47",
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
  modelUrl,
  modelAvailable,
  colorizeModel,
  colorizeLightMaterialsOnly,
  float,
  showEdges,
  demoCommand,
  demoMotion,
  deviceFeedback,
  workSimulation,
  showWorkEquipment,
  vesselHeading,
  vesselPosition,
  vesselScale,
}: {
  compact?: boolean;
  modelUrl: string;
  modelAvailable: boolean | null;
  colorizeModel: boolean;
  colorizeLightMaterialsOnly: boolean;
  float: boolean;
  showEdges: boolean;
  demoCommand?: BoatDemoCommand;
  demoMotion: boolean;
  deviceFeedback?: BoatDeviceFeedback;
  workSimulation: boolean;
  showWorkEquipment: boolean;
  vesselHeading: number;
  vesselPosition: [number, number];
  vesselScale: number;
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

    const baseScale = (compact ? 0.78 : 1) * vesselScale;
    const pulse = pulseRef.current;

    pulseRef.current = Math.max(0, pulse * 0.92 - 0.004);
    if (demoMotion) {
      const current = getRoutePoint(progressRef.current);
      const next = getRoutePoint(Math.min(1, progressRef.current + 0.012));
      group.current.position.x = current[0];
      group.current.position.z = current[2];
      group.current.rotation.y = Math.atan2(next[0] - current[0], next[2] - current[2]);
    } else {
      group.current.position.x = vesselPosition[0];
      group.current.position.z = vesselPosition[1];
      group.current.rotation.y = vesselHeading;
    }
    group.current.position.y = float ? Math.sin(state.clock.elapsedTime * 1.2) * 0.04 : 0;
    group.current.scale.setScalar(baseScale * (1 + pulse * 0.045));
  });

  return (
    <group ref={group} scale={(compact ? 0.78 : 1) * vesselScale}>
      {modelAvailable === null ? null : modelAvailable ? (
        <LoadedVessel
          modelUrl={modelUrl}
          colorizeModel={colorizeModel}
          colorizeLightMaterialsOnly={colorizeLightMaterialsOnly}
          showEdges={showEdges}
        />
      ) : (
        <ProceduralVessel />
      )}
      {deviceFeedback && !showWorkEquipment ? (
        <DeviceFeedbackRig feedback={deviceFeedback} importedModel={modelAvailable === true} />
      ) : null}
      {showWorkEquipment ? (
        <WorkEquipmentRig
          feedback={deviceFeedback}
          importedModel={modelAvailable === true}
          simulation={workSimulation}
        />
      ) : null}
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
    rotorRef.current.rotation.z += deltaTime * THREE.MathUtils.clamp(power / 100, -1, 1) * 14;
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

function WorkEquipmentRig({
  feedback,
  importedModel,
  simulation,
}: {
  feedback?: BoatDeviceFeedback;
  importedModel: boolean;
  simulation: boolean;
}) {
  const beltStripes = useRef<Array<THREE.Mesh | null>>([]);
  const debrisPieces = useRef<Array<THREE.Group | null>>([]);
  const rollerA = useRef<THREE.Mesh>(null);
  const rollerB = useRef<THREE.Mesh>(null);
  const conveyorPower = simulation ? 68 : feedback?.motorOnline ? feedback.motorPower : 0;
  const conveyorActive = Math.abs(conveyorPower) > 4;
  // Positive M0 power pulls floating debris from the bow back into the collection box.
  const direction = conveyorPower >= 0 ? -1 : 1;
  const rigScale = importedModel ? 1 : 2.15;

  useFrame((state, delta) => {
    if (!conveyorActive) return;
    const speed = THREE.MathUtils.clamp((Math.abs(conveyorPower) / 100) * 2, 0.35, 2);
    const travel = state.clock.elapsedTime * speed * direction;

    beltStripes.current.forEach((stripe, index) => {
      if (!stripe) return;
      stripe.position.x = -0.35 + THREE.MathUtils.euclideanModulo(index * 0.14 + travel * 0.17, 0.7);
    });
    debrisPieces.current.forEach((piece, index) => {
      if (!piece) return;
      const phase = THREE.MathUtils.euclideanModulo(index * 0.31 + travel * 0.12, 1);
      piece.position.x = THREE.MathUtils.lerp(-0.36, 0.37, phase);
      piece.position.y = 0.018 + Math.sin(phase * Math.PI) * 0.025;
      piece.rotation.y += delta * (1.1 + index * 0.25) * direction;
    });
    if (rollerA.current) rollerA.current.rotation.z -= delta * speed * 4.5 * direction;
    if (rollerB.current) rollerB.current.rotation.z -= delta * speed * 4.5 * direction;
  });

  return (
    <group
      position={importedModel ? [0, -0.32, 0] : [0, 0.25, 0]}
      rotation={importedModel ? [0, Math.PI, 0] : [0, 0, 0]}
      scale={rigScale}
    >
      <group position={[0.43, 0.31, 0.34]} rotation={[0, 0, -0.24]}>
        <mesh position={[0, -0.045, 0]}>
          <boxGeometry args={[0.86, 0.055, 0.34]} />
          <meshStandardMaterial color="#334155" metalness={0.18} roughness={0.52} />
        </mesh>
        <mesh position={[0, -0.008, 0]}>
          <boxGeometry args={[0.74, 0.035, 0.28]} />
          <meshStandardMaterial color="#153c46" roughness={0.68} />
        </mesh>
        {Array.from({ length: 6 }, (_, index) => (
          <mesh
            key={index}
            ref={(mesh) => {
              beltStripes.current[index] = mesh;
            }}
            position={[-0.35 + index * 0.14, 0.014, 0]}
          >
            <boxGeometry args={[0.027, 0.014, 0.275]} />
            <meshStandardMaterial color={conveyorActive ? "#48d7ca" : "#66838a"} emissive="#20b8aa" emissiveIntensity={conveyorActive ? 0.22 : 0.02} />
          </mesh>
        ))}
        {[-0.39, 0.39].map((x, index) => (
          <mesh
            key={x}
            ref={index === 0 ? rollerA : rollerB}
            position={[x, -0.004, 0]}
            rotation={[Math.PI / 2, 0, 0]}
          >
            <cylinderGeometry args={[0.055, 0.055, 0.32, 18]} />
            <meshStandardMaterial color="#78909c" metalness={0.5} roughness={0.3} />
          </mesh>
        ))}
        {[-0.17, 0.17].flatMap((z) =>
          [-0.28, 0.24].map((x) => (
            <mesh key={`${z}-${x}`} position={[x, -0.085, z]}>
              <boxGeometry args={[0.05, 0.13, 0.04]} />
              <meshStandardMaterial color="#536875" metalness={0.35} roughness={0.42} />
            </mesh>
          )),
        )}
        {[0, 1, 2].map((index) => (
          <group
            key={index}
            ref={(group) => {
              debrisPieces.current[index] = group;
            }}
            position={[-0.34 + index * 0.25, 0.025, (index - 1) * 0.065]}
          >
            {index === 1 ? (
              <mesh rotation={[0, 0, Math.PI / 2]}>
                <cylinderGeometry args={[0.025, 0.032, 0.105, 12]} />
                <meshStandardMaterial color="#7dd3fc" transparent opacity={0.84} roughness={0.3} />
              </mesh>
            ) : (
              <mesh rotation={[0.2, index * 0.8, 0.34]}>
                <boxGeometry args={[0.075, 0.03, 0.05]} />
                <meshStandardMaterial color={index === 0 ? "#f4c86f" : "#ec8d76"} roughness={0.72} />
              </mesh>
            )}
          </group>
        ))}
        <group position={[-0.5, -0.02, 0]}>
          <mesh>
            <boxGeometry args={[0.16, 0.18, 0.34]} />
            <meshStandardMaterial color="#274f59" metalness={0.14} roughness={0.55} />
          </mesh>
          <mesh position={[0, 0.105, 0]}>
            <boxGeometry args={[0.12, 0.045, 0.28]} />
            <meshStandardMaterial color="#74d3c6" emissive="#37cbbb" emissiveIntensity={conveyorActive ? 0.22 : 0.04} />
          </mesh>
        </group>
      </group>

      <CameraGimbal
        position={[-0.05, 0.53, 0.56]}
        yawAngle={feedback?.servoAngles[0] ?? null}
        pitchAngle={feedback?.servoAngles[1] ?? null}
        online={Boolean(feedback?.servoBoardOnline[0])}
        simulation={simulation}
      />
      <MappedServoMechanisms feedback={feedback} simulation={simulation} />
      <LinearActuatorMechanisms feedback={feedback} simulation={simulation} />
    </group>
  );
}

function CameraGimbal({
  position,
  yawAngle,
  pitchAngle,
  online,
  simulation,
}: {
  position: [number, number, number];
  yawAngle: number | null;
  pitchAngle: number | null;
  online: boolean;
  simulation: boolean;
}) {
  const yawRef = useRef<THREE.Group>(null);
  const pitchRef = useRef<THREE.Group>(null);
  const glowRef = useRef<THREE.MeshStandardMaterial>(null);

  useFrame((state, delta) => {
    if (!yawRef.current || !pitchRef.current) return;
    const simulatedYaw = Math.sin(state.clock.elapsedTime * 0.42) * 0.68;
    const simulatedPitch = -0.12 + Math.sin(state.clock.elapsedTime * 0.31) * 0.2;
    const targetYaw = simulation ? simulatedYaw : THREE.MathUtils.degToRad((yawAngle ?? 90) - 90);
    const targetPitch = simulation ? simulatedPitch : THREE.MathUtils.degToRad((90 - (pitchAngle ?? 90)) * 0.55);
    yawRef.current.rotation.y = simulation
      ? THREE.MathUtils.damp(yawRef.current.rotation.y, targetYaw, 7, delta)
      : targetYaw;
    pitchRef.current.rotation.z = simulation
      ? THREE.MathUtils.damp(pitchRef.current.rotation.z, targetPitch, 7, delta)
      : targetPitch;
    if (glowRef.current) {
      glowRef.current.emissiveIntensity = 0.16 + Math.sin(state.clock.elapsedTime * 2.4) * 0.05;
    }
  });

  const active = simulation || online;

  return (
    <group position={position} scale={0.72}>
      <mesh position={[0, -0.13, 0]}>
        <cylinderGeometry args={[0.055, 0.075, 0.27, 18]} />
        <meshStandardMaterial color="#526773" metalness={0.38} roughness={0.35} />
      </mesh>
      <group ref={yawRef}>
        <mesh>
          <cylinderGeometry args={[0.09, 0.09, 0.065, 20]} />
          <meshStandardMaterial color="#263c47" metalness={0.4} roughness={0.32} />
        </mesh>
        <group ref={pitchRef} position={[0, 0.055, 0]}>
          <mesh position={[0.105, 0, 0]}>
            <boxGeometry args={[0.21, 0.12, 0.14]} />
            <meshStandardMaterial color="#e9f1f1" metalness={0.12} roughness={0.4} />
          </mesh>
          <mesh position={[0.225, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.048, 0.048, 0.055, 20]} />
            <meshStandardMaterial ref={glowRef} color="#123743" emissive="#21d4cf" emissiveIntensity={active ? 0.16 : 0} roughness={0.24} />
          </mesh>
          <mesh position={[0.47, 0, 0]} rotation={[0, 0, -Math.PI / 2]} renderOrder={6}>
            <coneGeometry args={[0.18, 0.48, 4, 1, true]} />
            <meshBasicMaterial color="#63e6df" transparent opacity={active ? 0.09 : 0.025} depthWrite={false} side={THREE.DoubleSide} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

function MappedServoMechanisms({
  feedback,
  simulation,
}: {
  feedback?: BoatDeviceFeedback;
  simulation: boolean;
}) {
  const mechanisms: Array<{
    index: number;
    position: [number, number, number];
    baseRotation: number;
    color: string;
    phase: number;
  }> = [
    { index: 2, position: [0.3, 0.38, 0.08], baseRotation: -0.22, color: "#0ea5a8", phase: 0.2 },
    { index: 4, position: [0.3, 0.38, 0.6], baseRotation: 0.22, color: "#0ea5a8", phase: 1.1 },
    { index: 5, position: [-0.5, 0.27, 0.34], baseRotation: Math.PI / 2, color: "#f59e0b", phase: 2.0 },
    { index: 6, position: [-0.15, 0.35, 0.12], baseRotation: -0.08, color: "#6366f1", phase: 2.8 },
    { index: 7, position: [-0.15, 0.35, 0.56], baseRotation: 0.08, color: "#6366f1", phase: 3.6 },
  ];

  return (
    <group>
      {mechanisms.map((mechanism) => (
        <MappedServoArm
          key={mechanism.index}
          position={mechanism.position}
          baseRotation={mechanism.baseRotation}
          angle={feedback?.servoAngles[mechanism.index] ?? null}
          online={Boolean(feedback?.servoBoardOnline[mechanism.index < 4 ? 0 : 1])}
          simulation={simulation}
          simulationPhase={mechanism.phase}
          color={mechanism.color}
        />
      ))}
    </group>
  );
}

function MappedServoArm({
  position,
  baseRotation,
  angle,
  online,
  simulation,
  simulationPhase,
  color,
}: {
  position: [number, number, number];
  baseRotation: number;
  angle: number | null;
  online: boolean;
  simulation: boolean;
  simulationPhase: number;
  color: string;
}) {
  const pivotRef = useRef<THREE.Group>(null);
  const active = simulation || (online && angle !== null);

  useFrame((state, delta) => {
    if (!pivotRef.current) return;
    const target = simulation
      ? Math.sin(state.clock.elapsedTime * 0.48 + simulationPhase) * 0.62
      : THREE.MathUtils.degToRad((angle ?? 90) - 90);
    pivotRef.current.rotation.y = simulation
      ? THREE.MathUtils.damp(pivotRef.current.rotation.y, target, 6, delta)
      : target;
  });

  return (
    <group position={position} rotation={[0, baseRotation, 0]}>
      <mesh position={[0, -0.015, 0]}>
        <cylinderGeometry args={[0.045, 0.055, 0.075, 16]} />
        <meshStandardMaterial color={active ? "#d8f3f2" : "#94a3b8"} roughness={0.46} />
      </mesh>
      <group ref={pivotRef}>
        <mesh position={[0.105, 0.02, 0]}>
          <boxGeometry args={[0.21, 0.026, 0.052]} />
          <meshStandardMaterial
            color={active ? color : "#64748b"}
            emissive={active ? color : "#000000"}
            emissiveIntensity={active ? 0.16 : 0}
            roughness={0.42}
          />
        </mesh>
      </group>
    </group>
  );
}

function LinearActuatorMechanisms({
  feedback,
  simulation,
}: {
  feedback?: BoatDeviceFeedback;
  simulation: boolean;
}) {
  const dualPower = feedback?.dualPushrodPower ?? [0, 0];
  const sxtlBlocked = Boolean(
    feedback?.sxtlRuntimeLockout ||
    (feedback?.sxtlCooldownRemainingMs ?? 0) > 0,
  );

  return (
    <group>
      <EstimatedLinearActuator
        position={[-0.28, 0.22, 0.07]}
        rotation={[0, -0.18, 0]}
        power={-dualPower[0]}
        online={Boolean(feedback?.dualPushrodOnline)}
        simulation={simulation}
        simulationPhase={0}
        color="#22c55e"
      />
      <EstimatedLinearActuator
        position={[-0.28, 0.22, 0.61]}
        rotation={[0, 0.18, 0]}
        power={-dualPower[1]}
        online={Boolean(feedback?.dualPushrodOnline)}
        simulation={simulation}
        simulationPhase={1.2}
        color="#22c55e"
      />
      <EstimatedLinearActuator
        position={[-0.58, 0.18, 0.34]}
        rotation={[0, Math.PI, 0]}
        power={-(feedback?.sxtlPower ?? 0)}
        online={Boolean(feedback?.sxtlOnline)}
        simulation={simulation}
        simulationPhase={2.1}
        color={sxtlBlocked ? "#f59e0b" : "#06b6d4"}
      />
    </group>
  );
}

function EstimatedLinearActuator({
  position,
  rotation,
  power,
  online,
  simulation,
  simulationPhase,
  color,
}: {
  position: [number, number, number];
  rotation: [number, number, number];
  power: number;
  online: boolean;
  simulation: boolean;
  simulationPhase: number;
  color: string;
}) {
  const extensionRef = useRef(0.5);
  const rodRef = useRef<THREE.Mesh>(null);
  const tipRef = useRef<THREE.Mesh>(null);
  const active = simulation || (online && Math.abs(power) > 4);

  useFrame((state, delta) => {
    if (simulation) {
      extensionRef.current = 0.5 + Math.sin(state.clock.elapsedTime * 0.38 + simulationPhase) * 0.42;
    } else if (online && Math.abs(power) > 4) {
      extensionRef.current = THREE.MathUtils.clamp(
        extensionRef.current + THREE.MathUtils.clamp(power / 100, -1, 1) * delta * 0.16,
        0,
        1,
      );
    }

    const rodLength = 0.13 + extensionRef.current * 0.2;
    if (rodRef.current) {
      rodRef.current.scale.x = rodLength / 0.33;
      rodRef.current.position.x = 0.075 + rodLength / 2;
    }
    if (tipRef.current) {
      tipRef.current.position.x = 0.075 + rodLength;
    }
  });

  return (
    <group position={position} rotation={rotation} scale={0.78}>
      <mesh position={[-0.055, 0, 0]}>
        <boxGeometry args={[0.26, 0.075, 0.085]} />
        <meshStandardMaterial color={online || simulation ? "#334155" : "#64748b"} metalness={0.22} roughness={0.42} />
      </mesh>
      <mesh ref={rodRef} position={[0.24, 0, 0]}>
        <boxGeometry args={[0.33, 0.028, 0.034]} />
        <meshStandardMaterial
          color={active ? color : "#94a3b8"}
          emissive={active ? color : "#000000"}
          emissiveIntensity={active ? 0.16 : 0}
          metalness={0.36}
          roughness={0.3}
        />
      </mesh>
      <mesh ref={tipRef} position={[0.4, 0, 0]}>
        <sphereGeometry args={[0.035, 14, 14]} />
        <meshStandardMaterial color={active ? color : "#64748b"} roughness={0.38} />
      </mesh>
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

function LoadedVessel({
  modelUrl,
  colorizeModel,
  colorizeLightMaterialsOnly,
  showEdges,
}: {
  modelUrl: string;
  colorizeModel: boolean;
  colorizeLightMaterialsOnly: boolean;
  showEdges: boolean;
}) {
  const { scene } = useGLTF(modelUrl);
  const model = useMemo(
    () => prepareImportedModel(scene, colorizeModel, colorizeLightMaterialsOnly, showEdges),
    [scene, colorizeModel, colorizeLightMaterialsOnly, showEdges],
  );

  return (
    <group position={[0, -0.32, 0]} rotation={[0, Math.PI, 0]}>
      <primitive object={model} />
    </group>
  );
}

function prepareImportedModel(
  scene: THREE.Group,
  colorizeModel: boolean,
  colorizeLightMaterialsOnly: boolean,
  showEdges: boolean,
) {
  const sourceModel = scene.clone(true);
  sourceModel.updateMatrixWorld(true);
  const sourceBounds = new THREE.Box3().setFromObject(sourceModel);
  const sourceSize = sourceBounds.getSize(new THREE.Vector3());
  const sourceCenter = sourceBounds.getCenter(new THREE.Vector3());
  const normalizationScale = sourceSize.x > 0 ? REFERENCE_MODEL_LENGTH / sourceSize.x : 1;
  sourceModel.scale.multiplyScalar(normalizationScale);
  sourceModel.position
    .multiplyScalar(normalizationScale)
    .add(REFERENCE_MODEL_CENTER.clone().sub(sourceCenter.multiplyScalar(normalizationScale)));

  const model = new THREE.Group();
  model.add(sourceModel);
  model.updateMatrixWorld(true);
  const sceneBounds = new THREE.Box3().setFromObject(model);
  let meshIndex = 0;

  model.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;

    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.material = enhanceMaterial(mesh, sceneBounds, meshIndex, colorizeModel, colorizeLightMaterialsOnly);
    if (showEdges && colorizeModel && shouldAddEdgeOverlay(mesh)) {
      mesh.add(createEdgeOverlay(mesh, sceneBounds));
    }
    meshIndex += 1;
  });

  return model;
}

function enhanceMaterial(
  mesh: THREE.Mesh,
  sceneBounds: THREE.Box3,
  index: number,
  colorizeModel: boolean,
  colorizeLightMaterialsOnly: boolean,
) {
  const palette = colorizeLightMaterialsOnly ? LIGHT_MATERIAL_COLORS : MODEL_COLORS;
  const roleColor = colorizeModel ? chooseModelColor(mesh, sceneBounds, index, palette) : null;
  if (Array.isArray(mesh.material)) {
    return mesh.material.map((material) => enhanceSingleMaterial(material, roleColor, colorizeLightMaterialsOnly));
  }

  return enhanceSingleMaterial(mesh.material, roleColor, colorizeLightMaterialsOnly);
}

function enhanceSingleMaterial(original: THREE.Material, roleColor: string | null, colorizeLightMaterialsOnly: boolean) {
  const originalStandard = original instanceof THREE.MeshStandardMaterial ? original : null;
  const tintColor = roleColor && (!colorizeLightMaterialsOnly || shouldTintLightMaterial(originalStandard)) ? roleColor : null;
  const material = new THREE.MeshStandardMaterial({
    map: originalStandard?.map || null,
    normalMap: originalStandard?.normalMap || null,
    roughnessMap: originalStandard?.roughnessMap || null,
    metalnessMap: originalStandard?.metalnessMap || null,
    aoMap: originalStandard?.aoMap || null,
    emissiveMap: originalStandard?.emissiveMap || null,
    emissive: originalStandard?.emissive || new THREE.Color("#000000"),
    color: originalStandard?.color.clone() || new THREE.Color("#f4f7f8"),
    roughness: tintColor ? 0.82 : THREE.MathUtils.clamp(originalStandard?.roughness ?? 0.68, 0.28, 0.86),
    metalness: tintColor ? 0.02 : THREE.MathUtils.clamp(originalStandard?.metalness ?? 0.03, 0, 0.82),
    transparent: original.transparent,
    opacity: original.opacity,
    alphaTest: original.alphaTest,
    side: original.side,
    depthWrite: original.depthWrite,
  });

  if (tintColor && originalStandard?.map) {
    material.roughness = 0.74;
    material.metalness = Math.min(0.12, originalStandard.metalness || 0.04);
  }

  if (tintColor) {
    material.color.set(tintColor);
    material.roughness = getRoleRoughness(tintColor);
    material.metalness = getRoleMetalness(tintColor);
  }

  material.envMapIntensity = tintColor ? 0.24 : 0.46;
  material.needsUpdate = true;
  return material;
}

function shouldTintLightMaterial(material: THREE.MeshStandardMaterial | null) {
  if (!material || material.metalness > 0.45) return false;

  const { r, g, b } = material.color;
  const lightness = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const saturationRange = Math.max(r, g, b) - Math.min(r, g, b);
  return lightness > 0.68 && saturationRange < 0.16;
}

function getRoleRoughness(color: string) {
  if (color === MODEL_COLORS.hull || color === LIGHT_MATERIAL_COLORS.hull) return 0.58;
  if (color === MODEL_COLORS.sideHull || color === LIGHT_MATERIAL_COLORS.sideHull) return 0.66;
  if (color === MODEL_COLORS.hardware) return 0.68;
  return 0.76;
}

function getRoleMetalness(color: string) {
  if (color === MODEL_COLORS.hardware) return 0.14;
  if (color === MODEL_COLORS.hull || color === LIGHT_MATERIAL_COLORS.hull) return 0.04;
  if (color === MODEL_COLORS.sideHull || color === LIGHT_MATERIAL_COLORS.sideHull) return 0.02;
  return 0.02;
}

function chooseModelColor(
  mesh: THREE.Mesh,
  sceneBounds: THREE.Box3,
  _index: number,
  colors: Record<keyof typeof MODEL_COLORS, string>,
) {
  const name = mesh.name.toLowerCase();
  const box = new THREE.Box3().setFromObject(mesh);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const sceneSize = sceneBounds.getSize(new THREE.Vector3());
  const sceneCenter = sceneBounds.getCenter(new THREE.Vector3());
  const yRatio = sceneSize.y === 0 ? 0.5 : (center.y - sceneBounds.min.y) / sceneSize.y;
  const lateralRatio = sceneSize.z === 0 ? 0 : Math.abs(center.z - sceneCenter.z) / (sceneSize.z / 2);
  const relativeVolume = (size.x * size.y * size.z) / Math.max(0.0001, sceneSize.x * sceneSize.y * sceneSize.z);
  const thinPart = Math.min(size.x, size.y, size.z) < Math.max(sceneSize.y * 0.035, 0.015);

  if (/rail|pipe|motor|servo|prop|shaft|axis|wheel|arm|bracket|screw|bolt|rod|link|cylinder/.test(name) || relativeVolume < 0.004) {
    return colors.hardware;
  }
  if (/float|pontoon|outrigger/.test(name) || (/hull|body|boat|ship|bottom/.test(name) && lateralRatio > 0.42)) {
    return colors.sideHull;
  }
  if (/hull|body|boat|ship|bottom|float|pontoon/.test(name) || yRatio < 0.38) {
    return colors.hull;
  }
  if (/deck|floor|platform|panel/.test(name)) {
    return colors.deck;
  }
  if (/cabin|box|house|cover|lid|top/.test(name) || yRatio > 0.62) {
    return colors.cabin;
  }

  if (thinPart) return colors.hardware;
  if (yRatio < 0.48) return colors.hull;
  if (yRatio < 0.62) return colors.deck;
  return colors.cabin;
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
        <meshStandardMaterial color="#23677b" metalness={0.22} roughness={0.48} />
      </mesh>
      <mesh position={[2.55, -0.1, 0]} rotation={[0, 0, Math.PI / 2]}>
        <coneGeometry args={[0.62, 1.1, 4]} />
        <meshStandardMaterial color="#2e8792" metalness={0.18} roughness={0.44} />
      </mesh>
      <mesh position={[-2.4, -0.12, 0]} rotation={[0, 0, -Math.PI / 2]}>
        <coneGeometry args={[0.62, 0.88, 4]} />
        <meshStandardMaterial color="#1d5367" metalness={0.2} roughness={0.46} />
      </mesh>
      <mesh position={[0, 0.22, 0]}>
        <boxGeometry args={[2.25, 0.48, 0.86]} />
        <meshStandardMaterial color="#dbe4e2" emissive="#173943" emissiveIntensity={0.04} roughness={0.48} />
      </mesh>
      <mesh position={[0.74, 0.64, 0]}>
        <boxGeometry args={[0.9, 0.55, 0.68]} />
        <meshStandardMaterial color="#f2f0e8" emissive="#3f4d50" emissiveIntensity={0.03} roughness={0.52} />
      </mesh>
      <mesh position={[-0.6, 0.58, 0]} rotation={[0, 0, 0.18]}>
        <boxGeometry args={[0.9, 0.06, 1.05]} />
        <meshStandardMaterial color="#6aa6a1" emissive="#2e8792" emissiveIntensity={0.08} roughness={0.4} />
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

const CAGE_POSITIONS: Array<[number, number, number]> = [
  [-1.9, -0.4, -1.35],
  [1.95, -0.4, -1.35],
  [-1.9, -0.4, 1.35],
  [1.95, -0.4, 1.35],
];

function AquacultureEnvironment({ animate }: { animate: boolean }) {
  const farmBoundary: Array<[number, number, number]> = [
    [-2.75, -0.39, -2.15],
    [2.8, -0.39, -2.15],
    [2.8, -0.39, 2.15],
    [-2.75, -0.39, 2.15],
    [-2.75, -0.39, -2.15],
  ];

  return (
    <group>
      <DreiLine points={farmBoundary} color="#2f8f91" lineWidth={1.2} dashed dashSize={0.12} gapSize={0.08} transparent opacity={0.34} />
      {CAGE_POSITIONS.map((position, index) => (
        <AquacultureCage key={index} position={position} index={index} animate={animate} />
      ))}
      <FarmWalkway />
      <FeedStation position={[0, -0.315, -1.35]} animate={animate} />
      <PaddlewheelAerator position={[0, -0.34, 1.35]} animate={animate} />
      <WaterQualityBuoy position={[2.72, -0.34, 0]} animate={animate} />
      <FloatingDebris position={[0.78, -0.37, 0.58]} animate={animate} />
      <FloatingDebris position={[-0.92, -0.37, 0.72]} animate={animate} hue="amber" />
    </group>
  );
}

function FarmWalkway() {
  return (
    <group>
      <mesh position={[0.02, -0.335, -1.35]}>
        <boxGeometry args={[2.7, 0.05, 0.12]} />
        <meshStandardMaterial color="#e5eee9" metalness={0.14} roughness={0.55} />
      </mesh>
      <mesh position={[-1.9, -0.335, 0]}>
        <boxGeometry args={[0.12, 0.05, 1.55]} />
        <meshStandardMaterial color="#e5eee9" metalness={0.14} roughness={0.55} />
      </mesh>
      {[-1.2, -0.6, 0, 0.6, 1.2].map((x, index) => (
        <mesh key={`top-${x}`} position={[x, -0.31, -1.35]}>
          <boxGeometry args={[0.17, 0.045, 0.18]} />
          <meshStandardMaterial color={index % 2 === 0 ? "#f2bf52" : "#f8faf8"} roughness={0.38} />
        </mesh>
      ))}
      {[-0.6, 0, 0.6].map((z, index) => (
        <mesh key={`side-${z}`} position={[-1.9, -0.31, z]}>
          <boxGeometry args={[0.18, 0.045, 0.17]} />
          <meshStandardMaterial color={index % 2 === 0 ? "#f2bf52" : "#f8faf8"} roughness={0.38} />
        </mesh>
      ))}
    </group>
  );
}

function FeedStation({ position, animate }: { position: [number, number, number]; animate: boolean }) {
  const beaconRef = useRef<THREE.MeshStandardMaterial>(null);

  useFrame((state) => {
    if (!animate || !beaconRef.current) return;
    beaconRef.current.emissiveIntensity = 0.24 + Math.sin(state.clock.elapsedTime * 2.2) * 0.12;
  });

  return (
    <group position={position}>
      <mesh>
        <boxGeometry args={[0.46, 0.08, 0.32]} />
        <meshStandardMaterial color="#f4f6f1" metalness={0.18} roughness={0.48} />
      </mesh>
      <mesh position={[0, 0.18, 0]}>
        <cylinderGeometry args={[0.13, 0.18, 0.34, 18]} />
        <meshStandardMaterial color="#e6b958" metalness={0.08} roughness={0.55} />
      </mesh>
      <mesh position={[0, 0.39, 0]} rotation={[0, 0, Math.PI]}>
        <coneGeometry args={[0.15, 0.14, 18]} />
        <meshStandardMaterial color="#f3d486" roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.51, 0]}>
        <sphereGeometry args={[0.045, 14, 14]} />
        <meshStandardMaterial ref={beaconRef} color="#f97316" emissive="#f97316" emissiveIntensity={0.28} />
      </mesh>
      <mesh position={[0.24, 0.02, 0]} rotation={[0, 0, -0.35]}>
        <cylinderGeometry args={[0.025, 0.035, 0.36, 12]} />
        <meshStandardMaterial color="#596c74" metalness={0.28} roughness={0.4} />
      </mesh>
    </group>
  );
}

function PaddlewheelAerator({ position, animate }: { position: [number, number, number]; animate: boolean }) {
  const wheelRef = useRef<THREE.Group>(null);
  const bubblesRef = useRef<THREE.PointsMaterial>(null);
  const bubblePositions = useMemo(() => {
    const points: number[] = [];
    for (let index = 0; index < 22; index += 1) {
      const angle = (index / 22) * Math.PI * 2;
      const radius = 0.18 + (index % 4) * 0.055;
      points.push(Math.cos(angle) * radius, 0.015 + (index % 3) * 0.012, Math.sin(angle) * radius);
    }
    return new Float32Array(points);
  }, []);

  useFrame((state, delta) => {
    if (animate && wheelRef.current) wheelRef.current.rotation.z += delta * 2.8;
    if (animate && bubblesRef.current) bubblesRef.current.opacity = 0.38 + Math.sin(state.clock.elapsedTime * 3) * 0.12;
  });

  return (
    <group position={position}>
      <mesh position={[0, -0.025, 0]}>
        <boxGeometry args={[0.7, 0.06, 0.22]} />
        <meshStandardMaterial color="#f6f8f5" metalness={0.12} roughness={0.5} />
      </mesh>
      <mesh position={[-0.27, 0.005, 0]}>
        <cylinderGeometry args={[0.075, 0.075, 0.25, 14]} />
        <meshStandardMaterial color="#f1b94e" roughness={0.45} />
      </mesh>
      <mesh position={[0.27, 0.005, 0]}>
        <cylinderGeometry args={[0.075, 0.075, 0.25, 14]} />
        <meshStandardMaterial color="#f1b94e" roughness={0.45} />
      </mesh>
      <group ref={wheelRef} position={[0, 0.12, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <mesh>
          <cylinderGeometry args={[0.055, 0.055, 0.28, 14]} />
          <meshStandardMaterial color="#4f6570" metalness={0.38} roughness={0.34} />
        </mesh>
        {[0, Math.PI / 2].map((rotation) => (
          <mesh key={rotation} rotation={[0, 0, rotation]}>
            <boxGeometry args={[0.42, 0.045, 0.24]} />
            <meshStandardMaterial color="#38b5b2" emissive="#38b5b2" emissiveIntensity={0.08} roughness={0.46} />
          </mesh>
        ))}
      </group>
      <points position={[0, -0.04, 0]} renderOrder={5}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[bubblePositions, 3]} />
        </bufferGeometry>
        <pointsMaterial ref={bubblesRef} color="#f7ffff" size={0.045} transparent opacity={0.42} depthWrite={false} />
      </points>
    </group>
  );
}

function WaterQualityBuoy({ position, animate }: { position: [number, number, number]; animate: boolean }) {
  const buoyRef = useRef<THREE.Group>(null);
  const pulseRef = useRef<THREE.MeshBasicMaterial>(null);

  useFrame((state) => {
    if (!animate) return;
    if (buoyRef.current) buoyRef.current.position.y = position[1] + Math.sin(state.clock.elapsedTime * 0.8) * 0.018;
    if (pulseRef.current) pulseRef.current.opacity = 0.12 + (Math.sin(state.clock.elapsedTime * 2.4) + 1) * 0.07;
  });

  return (
    <group ref={buoyRef} position={position}>
      <mesh>
        <cylinderGeometry args={[0.14, 0.2, 0.18, 18]} />
        <meshStandardMaterial color="#f5b94d" roughness={0.42} />
      </mesh>
      <mesh position={[0, 0.22, 0]}>
        <cylinderGeometry args={[0.025, 0.035, 0.34, 12]} />
        <meshStandardMaterial color="#4d606a" metalness={0.32} roughness={0.38} />
      </mesh>
      <mesh position={[0, 0.41, 0]}>
        <sphereGeometry args={[0.055, 14, 14]} />
        <meshStandardMaterial color="#31d8cf" emissive="#31d8cf" emissiveIntensity={0.55} />
      </mesh>
      <mesh position={[0, 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={5}>
        <ringGeometry args={[0.24, 0.31, 32]} />
        <meshBasicMaterial ref={pulseRef} color="#29b9b4" transparent opacity={0.18} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

function AquacultureCage({
  position,
  index,
  animate,
}: {
  position: [number, number, number];
  index: number;
  animate: boolean;
}) {
  const cageRef = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (!animate || !cageRef.current) return;
    cageRef.current.position.y = position[1] + Math.sin(state.clock.elapsedTime * 0.7 + index * 1.4) * 0.018;
  });

  return (
    <group ref={cageRef} position={position}>
      <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={4}>
        <circleGeometry args={[0.565, 40]} />
        <meshBasicMaterial color={index % 2 === 0 ? "#4fa59e" : "#5798a1"} transparent opacity={0.12} depthWrite={false} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.62, 0.055, 12, 40]} />
        <meshStandardMaterial color="#ecf7f4" metalness={0.18} roughness={0.42} />
      </mesh>
      <mesh position={[0, 0.018, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.48, 0.012, 8, 36]} />
        <meshStandardMaterial color="#5ba5a1" transparent opacity={0.52} roughness={0.55} />
      </mesh>
      {[-0.32, -0.16, 0, 0.16, 0.32].flatMap((offset) => [
        <DreiLine
          key={`net-x-${offset}`}
          points={[[-0.45, 0.026, offset], [0.45, 0.026, offset]]}
          color="#65aaa6"
          lineWidth={0.65}
          transparent
          opacity={0.38}
        />,
        <DreiLine
          key={`net-z-${offset}`}
          points={[[offset, 0.026, -0.45], [offset, 0.026, 0.45]]}
          color="#65aaa6"
          lineWidth={0.65}
          transparent
          opacity={0.38}
        />,
      ])}
      <mesh position={[0, -0.52, 0]}>
        <cylinderGeometry args={[0.58, 0.42, 1.02, 24, 5, true]} />
        <meshBasicMaterial color="#499c9b" transparent opacity={0.12} wireframe depthWrite={false} />
      </mesh>
      <mesh position={[0, -1.02, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.42, 24]} />
        <meshBasicMaterial color="#3d858b" transparent opacity={0.08} wireframe depthWrite={false} />
      </mesh>
      {Array.from({ length: 8 }, (_, buoyIndex) => {
        const angle = (buoyIndex / 8) * Math.PI * 2;
        return (
          <mesh key={buoyIndex} position={[Math.cos(angle) * 0.62, 0.015, Math.sin(angle) * 0.62]}>
            <sphereGeometry args={[0.065, 14, 14]} />
            <meshStandardMaterial color={buoyIndex % 2 === 0 ? "#f5b84b" : "#f7f9f4"} roughness={0.38} />
          </mesh>
        );
      })}
      <FishSchool index={index} animate={animate} />
    </group>
  );
}

function FishSchool({ index, animate }: { index: number; animate: boolean }) {
  const schoolRef = useRef<THREE.Group>(null);

  useFrame((state, delta) => {
    if (!animate || !schoolRef.current) return;
    schoolRef.current.rotation.y += delta * (0.18 + index * 0.035);
    schoolRef.current.position.y = -0.075 + Math.sin(state.clock.elapsedTime * 0.75 + index) * 0.028;
  });

  return (
    <group ref={schoolRef} position={[0, -0.075, 0]}>
      {Array.from({ length: 9 }, (_, fishIndex) => {
        const angle = (fishIndex / 9) * Math.PI * 2;
        const radius = 0.19 + (fishIndex % 3) * 0.095;
        return (
          <group
            key={fishIndex}
            position={[
              Math.cos(angle) * radius,
              ((fishIndex % 4) - 1.5) * 0.075,
              Math.sin(angle) * radius,
            ]}
            rotation={[0, -angle + Math.PI / 2, 0]}
            scale={0.7 + (fishIndex % 2) * 0.16}
          >
            <mesh scale={[1, 0.55, 0.42]}>
              <sphereGeometry args={[0.055, 10, 8]} />
              <meshStandardMaterial color={fishIndex % 3 === 0 ? "#ffd17a" : "#68c3c0"} roughness={0.5} />
            </mesh>
            <mesh position={[-0.072, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
              <coneGeometry args={[0.035, 0.065, 3]} />
              <meshStandardMaterial color={fishIndex % 3 === 0 ? "#e9a63f" : "#479e9c"} roughness={0.58} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

function FloatingDebris({
  position,
  animate,
  hue = "blue",
}: {
  position: [number, number, number];
  animate: boolean;
  hue?: "blue" | "amber";
}) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (!animate || !groupRef.current) return;
    groupRef.current.position.y = position[1] + Math.sin(state.clock.elapsedTime * 0.9 + position[0]) * 0.018;
    groupRef.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.24 + position[2]) * 0.2;
  });

  return (
    <group ref={groupRef} position={position} rotation={[0.12, 0.4, -0.08]}>
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.045, 0.052, 0.2, 12]} />
        <meshStandardMaterial color={hue === "blue" ? "#75cdec" : "#e9b456"} transparent opacity={0.84} roughness={0.42} />
      </mesh>
      <mesh position={[0.1, 0.015, 0]} rotation={[0.1, 0.2, 0.2]}>
        <boxGeometry args={[0.12, 0.022, 0.075]} />
        <meshStandardMaterial color={hue === "blue" ? "#d7f1f5" : "#f4d895"} roughness={0.72} />
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
  if (hero) return [4.8, 2.1, 5.05];
  if (viewMode === "top") return [0, 6.3, 0.001];
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
    camera.up.set(0, viewMode === "top" ? 0 : 1, viewMode === "top" ? -1 : 0);
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
  modelUrl = DEFAULT_MODEL_URL,
  compact = false,
  showGrid = true,
  showOcean = true,
  liveOcean = true,
  hero = false,
  colorizeModel = true,
  colorizeLightMaterialsOnly = false,
  autoRotate,
  float,
  showEdges = false,
  pauseAutoRotateOnInteract,
  viewMode = "follow",
  demoCommand,
  deviceFeedback,
  simulationPreview,
  workSimulation = false,
  showWorkEquipment = false,
  showAquaculture = false,
  vesselHeading = 0,
  vesselPosition = [0, 0],
  vesselScale = 1,
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
    setModelAvailable(null);
    fetch(modelUrl, { method: "HEAD" })
      .then((response) => {
        if (!cancelled) {
          setModelAvailable(response.ok);
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
  }, [modelUrl]);

  useEffect(() => () => {
    if (calmTimer.current) window.clearTimeout(calmTimer.current);
  }, []);

  // Render-loop control: the landing view renders continuously while it rotates.
  // Other scenes render on demand during genuine motion (float, demo, motor
  // feedback) or while the user is interacting; otherwise the water
  // idles at a gentle 12fps and the GPU goes quiet when the tab is hidden or the
  // live-ocean animation is switched off.
  const motorActive = Math.abs(deviceFeedback?.motorPower ?? 0) > 4;
  const linearActuatorActive = [
    ...(deviceFeedback?.dualPushrodPower ?? [0, 0]),
    deviceFeedback?.sxtlPower ?? 0,
  ].some((power) => Math.abs(power) > 4);
  const highMotion = activeAutoRotate || shouldFloat || demoActive || motorActive || linearActuatorActive || workSimulation || Boolean(simulationPreview?.active);
  const active = highMotion || interacting || (liveOcean && documentVisible);
  const fps = highMotion || interacting ? 30 : 12;
  const vessel = (
    <VesselRig
      compact={compact}
      modelUrl={modelUrl}
      modelAvailable={modelAvailable}
      colorizeModel={colorizeModel}
      colorizeLightMaterialsOnly={colorizeLightMaterialsOnly}
      float={shouldFloat}
      showEdges={showEdges}
      demoCommand={demoCommand}
      demoMotion={!hero && Boolean(demoCommand?.nonce)}
      deviceFeedback={deviceFeedback}
      workSimulation={workSimulation}
      showWorkEquipment={showWorkEquipment}
      vesselHeading={vesselHeading}
      vesselPosition={vesselPosition}
      vesselScale={vesselScale}
    />
  );
  const useFixedTopComposition = viewMode === "top" && showAquaculture;

  return (
    <div className="relative h-full w-full">
      <Canvas
        className="h-full w-full touch-none"
        camera={{ position: cameraPosition as [number, number, number], fov: hero ? 33 : 36, near: 0.03, far: 250 }}
        dpr={hero ? [0.82, 1.08] : [0.78, 1]}
        frameloop={hero && activeAutoRotate ? "always" : "demand"}
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
        {useFixedTopComposition ? vessel : <Bounds fit margin={hero ? 1.16 : 0.9}>{vessel}</Bounds>}
        {hero && <PresentationShadow />}
        {showOcean && <OceanPlane animate={liveOcean} />}
        {showOcean && showAquaculture && !hero ? <AquacultureEnvironment animate={liveOcean || workSimulation} /> : null}
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
          enableRotate={viewMode !== "top"}
          autoRotate={activeAutoRotate && viewMode !== "top"}
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

useGLTF.preload(DEFAULT_MODEL_URL);
