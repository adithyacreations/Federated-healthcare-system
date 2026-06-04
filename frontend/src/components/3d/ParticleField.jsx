import { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

const COUNT = 2000;

const Particles = () => {
  const ref = useRef();

  const positions = useMemo(() => {
    const arr = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 12;       // x
      arr[i * 3 + 1] = (Math.random() - 0.5) * 10;   // y
      arr[i * 3 + 2] = (Math.random() - 0.5) * 12;   // z
    }
    return arr;
  }, []);

  useFrame(() => {
    if (!ref.current) return;
    const arr = ref.current.geometry.attributes.position.array;
    for (let i = 0; i < COUNT; i++) {
      arr[i * 3 + 1] += 0.002;
      if (arr[i * 3 + 1] > 5) {
        arr[i * 3 + 1] = -5;
      }
    }
    ref.current.geometry.attributes.position.needsUpdate = true;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={COUNT}
          array={positions}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        color="#00D4FF"
        size={0.02}
        transparent
        opacity={0.6}
        sizeAttenuation
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  );
};

const ParticleField = () => (
  <Canvas
    className="particle-canvas"
    camera={{ position: [0, 0, 6], fov: 60 }}
    style={{ background: 'transparent' }}
    dpr={[1, 1.5]}
  >
    <Particles />
  </Canvas>
);

export default ParticleField;
