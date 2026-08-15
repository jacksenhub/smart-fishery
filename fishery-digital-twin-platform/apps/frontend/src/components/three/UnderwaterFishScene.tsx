"use client";

import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { FishObservation } from "@/lib/fish-vision";

const MAX_FISH = 180;
const FORWARD = new THREE.Vector3(1, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);

interface UnderwaterFishSceneProps {
  density: number;
  observations?: FishObservation[];
  active?: boolean;
}

interface FishAgent {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  phase: number;
  scale: number;
  speed: number;
  turnRate: number;
}

function deterministicValue(index: number, salt: number) {
  const raw = Math.sin((index + 1) * (12.9898 + salt * 7.13)) * 43758.5453;
  return raw - Math.floor(raw);
}

export function fishCountFromDensity(density: number) {
  const normalizedDensity = THREE.MathUtils.clamp(density, 0, 100);
  return Math.round(normalizedDensity * 1.7);
}

export function UnderwaterFishScene({ density, observations = [], active = true }: UnderwaterFishSceneProps) {
  const normalizedDensity = THREE.MathUtils.clamp(density, 0, 100);

  return (
    <Canvas
      dpr={[1, 1.5]}
      frameloop={active ? "always" : "demand"}
      camera={{ position: [7.2, 2.4, 7.8], fov: 48, near: 0.1, far: 40 }}
      gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
    >
      <UnderwaterWorld density={normalizedDensity} observations={observations} active={active} />
    </Canvas>
  );
}

function UnderwaterWorld({
  density,
  observations,
  active,
}: {
  density: number;
  observations: FishObservation[];
  active: boolean;
}) {
  return (
    <>
      <color attach="background" args={["#062b38"]} />
      <fog attach="fog" args={["#0a3c49", 5, 17]} />
      <ambientLight intensity={0.72} color="#8bdfe1" />
      <hemisphereLight args={["#a8ffff", "#123d39", 1.2]} />
      <directionalLight position={[-3, 6, 4]} intensity={2.2} color="#b8ffff" />
      <pointLight position={[3, 0.8, -2]} intensity={7} distance={8} color="#48cbd1" />

      <WaterSurface active={active} />
      <SeaFloor />
      <SuspendedParticles active={active} />
      <InstancedFishSchool density={density} observations={observations} active={active} />

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.065}
        minDistance={4}
        maxDistance={14}
        minPolarAngle={0.28}
        maxPolarAngle={1.72}
        target={[0, -0.25, 0]}
      />
    </>
  );
}

function InstancedFishSchool({
  density,
  observations,
  active,
}: {
  density: number;
  observations: FishObservation[];
  active: boolean;
}) {
  const bodiesRef = useRef<THREE.InstancedMesh>(null);
  const tailsRef = useRef<THREE.InstancedMesh>(null);
  const count = fishCountFromDensity(density);
  const agents = useMemo<FishAgent[]>(
    () => Array.from({ length: MAX_FISH }, (_, index) => {
      const angle = deterministicValue(index, 1) * Math.PI * 2;
      const verticalAngle = (deterministicValue(index, 2) - 0.5) * 0.28;
      return {
        position: new THREE.Vector3(
          (deterministicValue(index, 3) - 0.5) * 10,
          -1.8 + deterministicValue(index, 4) * 3.4,
          (deterministicValue(index, 5) - 0.5) * 6,
        ),
        velocity: new THREE.Vector3(
          Math.cos(angle) * Math.cos(verticalAngle),
          Math.sin(verticalAngle),
          Math.sin(angle) * Math.cos(verticalAngle),
        ).normalize(),
        phase: deterministicValue(index, 6) * Math.PI * 2,
        scale: 0.7 + deterministicValue(index, 7) * 0.62,
        speed: 0.42 + deterministicValue(index, 8) * 0.38,
        turnRate: 0.42 + deterministicValue(index, 9) * 0.55,
      };
    }),
    [],
  );
  const bodyColor = useMemo(() => new THREE.Color(), []);
  const tailColor = useMemo(() => new THREE.Color(), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const direction = useMemo(() => new THREE.Vector3(), []);
  const tailDirection = useMemo(() => new THREE.Vector3(), []);
  const tailPosition = useMemo(() => new THREE.Vector3(), []);
  const side = useMemo(() => new THREE.Vector3(), []);
  const bodyQuaternion = useMemo(() => new THREE.Quaternion(), []);
  const tailQuaternion = useMemo(() => new THREE.Quaternion(), []);

  useEffect(() => {
    const bodies = bodiesRef.current;
    const tails = tailsRef.current;
    if (!bodies || !tails) return;

    bodies.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    tails.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    agents.forEach((_, index) => {
      const colorSelector = deterministicValue(index, 10);
      if (colorSelector > 0.82) {
        bodyColor.set("#f4c66d");
        tailColor.set("#d99b46");
      } else if (colorSelector > 0.54) {
        bodyColor.set("#74d6cc");
        tailColor.set("#3ca4a3");
      } else {
        bodyColor.set("#79bedd");
        tailColor.set("#3d82aa");
      }
      bodies.setColorAt(index, bodyColor);
      tails.setColorAt(index, tailColor);
    });
    if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;
    if (tails.instanceColor) tails.instanceColor.needsUpdate = true;
  }, [agents, bodyColor, tailColor]);

  useFrame((state, delta) => {
    if (!active || !bodiesRef.current || !tailsRef.current) return;

    const bodies = bodiesRef.current;
    const tails = tailsRef.current;
    const elapsed = state.clock.elapsedTime;
    const frameDelta = Math.min(delta, 0.04);
    const densitySpeed = 0.94 + density / 800;
    bodies.count = count;
    tails.count = count;

    for (let index = 0; index < count; index += 1) {
      const fish = agents[index];
      const swimTime = elapsed * fish.turnRate + fish.phase;

      fish.velocity.x += (Math.sin(swimTime * 0.73) * 0.16 - fish.position.x * 0.018) * frameDelta;
      fish.velocity.y += (Math.sin(swimTime * 1.27) * 0.08 - fish.position.y * 0.035) * frameDelta;
      fish.velocity.z += (Math.cos(swimTime * 0.61) * 0.16 - fish.position.z * 0.026) * frameDelta;

      if (observations.length > 0) {
        const observation = observations[index % observations.length];
        const clusterIndex = Math.floor(index / observations.length);
        const clusterAngle = fish.phase + clusterIndex * 1.37;
        const clusterRadius = 0.28 + observation.size * 0.34;
        const targetX = observation.x * 4.7 + Math.cos(clusterAngle) * clusterRadius;
        const targetY = observation.y * 1.65 - 0.25 + Math.sin(clusterAngle * 1.4) * clusterRadius * 0.45;
        const targetZ = (observation.size - 0.7) * 1.2 + Math.sin(clusterAngle * 0.8) * 1.15;
        const trackingStrength = 0.075 + observation.confidence * 0.075;
        const positionResponse = (0.34 + observation.confidence * 0.26) * frameDelta;
        fish.velocity.x += (targetX - fish.position.x) * trackingStrength * frameDelta;
        fish.velocity.y += (targetY - fish.position.y) * trackingStrength * frameDelta;
        fish.velocity.z += (targetZ - fish.position.z) * trackingStrength * frameDelta;
        fish.position.x += (targetX - fish.position.x) * positionResponse;
        fish.position.y += (targetY - fish.position.y) * positionResponse;
        fish.position.z += (targetZ - fish.position.z) * positionResponse;
      }

      if (Math.abs(fish.position.x) > 5.25) {
        fish.velocity.x -= Math.sign(fish.position.x) * frameDelta * 1.8;
      }
      if (fish.position.y > 1.75 || fish.position.y < -2.05) {
        fish.velocity.y -= Math.sign(fish.position.y + 0.15) * frameDelta * 1.5;
      }
      if (Math.abs(fish.position.z) > 3.25) {
        fish.velocity.z -= Math.sign(fish.position.z) * frameDelta * 1.8;
      }

      fish.velocity.normalize();
      fish.position.addScaledVector(fish.velocity, fish.speed * densitySpeed * frameDelta);
      direction.copy(fish.velocity).normalize();

      const fishScale = fish.scale * 0.26;
      bodyQuaternion.setFromUnitVectors(FORWARD, direction);
      dummy.position.copy(fish.position);
      dummy.quaternion.copy(bodyQuaternion);
      dummy.scale.set(fishScale * 1.75, fishScale * 0.64, fishScale * 0.52);
      dummy.updateMatrix();
      bodies.setMatrixAt(index, dummy.matrix);

      side.set(-direction.z, 0, direction.x).normalize();
      tailDirection.copy(direction)
        .addScaledVector(side, Math.sin(elapsed * 8.5 + fish.phase) * 0.2)
        .normalize();
      tailPosition.copy(fish.position).addScaledVector(direction, -fishScale * 1.72);
      tailQuaternion.setFromUnitVectors(UP, tailDirection);
      dummy.position.copy(tailPosition);
      dummy.quaternion.copy(tailQuaternion);
      dummy.scale.set(fishScale * 0.52, fishScale * 1.05, fishScale * 0.18);
      dummy.updateMatrix();
      tails.setMatrixAt(index, dummy.matrix);
    }

    bodies.instanceMatrix.needsUpdate = true;
    tails.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      <instancedMesh ref={bodiesRef} args={[undefined, undefined, MAX_FISH]} frustumCulled={false}>
        <sphereGeometry args={[1, 10, 8]} />
        <meshStandardMaterial roughness={0.42} metalness={0.02} />
      </instancedMesh>
      <instancedMesh ref={tailsRef} args={[undefined, undefined, MAX_FISH]} frustumCulled={false}>
        <coneGeometry args={[1, 1, 3]} />
        <meshStandardMaterial roughness={0.5} side={THREE.DoubleSide} />
      </instancedMesh>
    </>
  );
}

function WaterSurface({ active }: { active: boolean }) {
  const surfaceRef = useRef<THREE.Mesh<THREE.PlaneGeometry>>(null);

  useFrame((state) => {
    if (!active || !surfaceRef.current) return;
    const positions = surfaceRef.current.geometry.attributes.position as THREE.BufferAttribute;
    const elapsed = state.clock.elapsedTime;
    for (let index = 0; index < positions.count; index += 1) {
      const x = positions.getX(index);
      const y = positions.getY(index);
      const wave = Math.sin(x * 0.75 + elapsed * 0.75) * 0.08
        + Math.cos(y * 0.92 + elapsed * 0.55) * 0.055;
      positions.setZ(index, wave);
    }
    positions.needsUpdate = true;
  });

  return (
    <mesh ref={surfaceRef} position={[0, 2.25, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[16, 11, 30, 20]} />
      <meshPhysicalMaterial
        color="#47bac5"
        transparent
        opacity={0.34}
        roughness={0.22}
        metalness={0.05}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  );
}

function SeaFloor() {
  const rocks = useMemo(
    () => Array.from({ length: 18 }, (_, index) => ({
      position: [
        (deterministicValue(index, 21) - 0.5) * 12,
        -2.38 + deterministicValue(index, 22) * 0.08,
        (deterministicValue(index, 23) - 0.5) * 8,
      ] as [number, number, number],
      scale: [
        0.16 + deterministicValue(index, 24) * 0.34,
        0.1 + deterministicValue(index, 25) * 0.18,
        0.14 + deterministicValue(index, 26) * 0.3,
      ] as [number, number, number],
    })),
    [],
  );

  return (
    <group>
      <mesh position={[0, -2.5, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[18, 12, 28, 20]} />
        <meshStandardMaterial color="#567361" roughness={0.96} />
      </mesh>
      <mesh position={[-2.4, -2.46, 0.3]} rotation={[-Math.PI / 2, 0, -0.18]}>
        <ringGeometry args={[0.7, 3.5, 64]} />
        <meshBasicMaterial color="#8bc6ac" transparent opacity={0.055} depthWrite={false} />
      </mesh>
      {rocks.map((rock, index) => (
        <mesh key={index} position={rock.position} scale={rock.scale} rotation={[0, index * 0.74, 0]}>
          <dodecahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color={index % 3 === 0 ? "#46645a" : "#637d68"} roughness={0.92} />
        </mesh>
      ))}
    </group>
  );
}

function SuspendedParticles({ active }: { active: boolean }) {
  const particlesRef = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const values = new Float32Array(420 * 3);
    for (let index = 0; index < 420; index += 1) {
      values[index * 3] = (deterministicValue(index, 31) - 0.5) * 13;
      values[index * 3 + 1] = -2.2 + deterministicValue(index, 32) * 4.2;
      values[index * 3 + 2] = (deterministicValue(index, 33) - 0.5) * 8;
    }
    return values;
  }, []);

  useFrame((state, delta) => {
    if (!active || !particlesRef.current) return;
    particlesRef.current.rotation.y += delta * 0.012;
    particlesRef.current.position.y = Math.sin(state.clock.elapsedTime * 0.18) * 0.12;
  });

  return (
    <points ref={particlesRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        color="#b8f3e5"
        size={0.026}
        transparent
        opacity={0.42}
        depthWrite={false}
        sizeAttenuation
      />
    </points>
  );
}
