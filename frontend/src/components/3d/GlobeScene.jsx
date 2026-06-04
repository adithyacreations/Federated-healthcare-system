import { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Sphere, MeshDistortMaterial, Stars, OrbitControls, Line } from '@react-three/drei';
import * as THREE from 'three';

const HOSPITAL_COORDS = [
  { lat: 28.6, lng: 77.2 },   // Delhi
  { lat: 19.0, lng: 72.8 },   // Mumbai
  { lat: 12.9, lng: 77.5 },   // Bangalore
  { lat: 13.0, lng: 80.2 },   // Chennai
  { lat: 22.5, lng: 88.3 },   // Kolkata
  { lat: 17.3, lng: 78.4 },   // Hyderabad
  { lat: 8.5,  lng: 76.9 },   // Trivandrum
  { lat: 26.8, lng: 80.9 },   // Lucknow
];

const latLngToVec3 = (lat, lng, radius = 2.05) => {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  );
};

const RotatingGlobe = () => {
  const meshRef = useRef();

  useFrame(({ clock }) => {
    if (meshRef.current) {
      meshRef.current.rotation.y += 0.003;
      meshRef.current.rotation.x += 0.001;
      const t = clock.getElapsedTime();
      meshRef.current.position.y = Math.sin(t * 0.5) * 0.05;
    }
  });

  return (
    <Sphere ref={meshRef} args={[2, 64, 64]}>
      <MeshDistortMaterial
        color="#1A3C6E"
        emissive="#00D4FF"
        emissiveIntensity={0.3}
        distort={0.2}
        speed={1.5}
        roughness={0.1}
        metalness={0.5}
      />
    </Sphere>
  );
};

const HospitalPoint = ({ position, delay = 0 }) => {
  const ref = useRef();
  useFrame(({ clock }) => {
    if (ref.current) {
      const t = clock.getElapsedTime() + delay;
      const scale = 1 + 0.3 * Math.sin(t * 2);
      ref.current.scale.set(scale, scale, scale);
    }
  });

  return (
    <mesh ref={ref} position={position}>
      <sphereGeometry args={[0.05, 16, 16]} />
      <meshStandardMaterial
        color="#00D4FF"
        emissive="#00D4FF"
        emissiveIntensity={1.5}
        toneMapped={false}
      />
    </mesh>
  );
};

const HospitalPoints = ({ groupRef, points }) => (
  <group ref={groupRef}>
    {points.map((p, i) => (
      <HospitalPoint key={i} position={p.toArray()} delay={i * 0.5} />
    ))}
  </group>
);

const PulsingLine = ({ start, end, delay = 0 }) => {
  const ref = useRef();

  // Build a curved arc between the two points
  const curvePoints = useMemo(() => {
    const mid = start.clone().add(end).multiplyScalar(0.5);
    mid.normalize().multiplyScalar(2.6); // arc above the surface
    const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
    return curve.getPoints(40);
  }, [start, end]);

  useFrame(({ clock }) => {
    if (ref.current) {
      const t = clock.getElapsedTime() + delay;
      const opacity = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(t * 1.5));
      ref.current.material.opacity = opacity;
    }
  });

  return (
    <Line
      ref={ref}
      points={curvePoints}
      color="#00D4FF"
      lineWidth={1}
      transparent
      opacity={0.5}
    />
  );
};

const ConnectionLines = ({ points }) => {
  // Connect each hospital to the next, plus a few cross-links
  const pairs = useMemo(() => {
    const out = [];
    for (let i = 0; i < points.length; i++) {
      out.push([points[i], points[(i + 1) % points.length]]);
    }
    // a few diagonals for extra network feel
    out.push([points[0], points[3]]);
    out.push([points[2], points[5]]);
    out.push([points[4], points[7]]);
    return out;
  }, [points]);

  return (
    <group>
      {pairs.map(([a, b], i) => (
        <PulsingLine key={i} start={a} end={b} delay={i * 0.4} />
      ))}
    </group>
  );
};

const GlobeScene = () => {
  const points = useMemo(
    () => HOSPITAL_COORDS.map((c) => latLngToVec3(c.lat, c.lng, 2.05)),
    []
  );
  const groupRef = useRef();

  return (
    <Canvas
      camera={{ position: [0, 0, 6], fov: 60 }}
      style={{ background: 'transparent' }}
      dpr={[1, 2]}
    >
      <ambientLight intensity={0.5} />
      <pointLight position={[10, 10, 10]} intensity={1} />
      <pointLight position={[-10, -5, -10]} intensity={0.4} color="#00D4FF" />
      <Stars radius={100} depth={50} count={3000} factor={4} saturation={0} fade speed={1} />

      {/* Group rotates the points + lines together so they stay anchored */}
      <group rotation={[0, 0, 0]}>
        <RotatingGlobe />
        <SpinningGroup>
          <HospitalPoints groupRef={groupRef} points={points} />
          <ConnectionLines points={points} />
        </SpinningGroup>
      </group>

      <OrbitControls enableZoom={false} enablePan={false} autoRotate={false} />
    </Canvas>
  );
};

// Spins the points + lines at the same rate as the globe so they stick to it
const SpinningGroup = ({ children }) => {
  const ref = useRef();
  useFrame(() => {
    if (ref.current) {
      ref.current.rotation.y += 0.003;
      ref.current.rotation.x += 0.001;
    }
  });
  return <group ref={ref}>{children}</group>;
};

export default GlobeScene;
