import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { ThreeMFLoader } from "three/examples/jsm/loaders/3MFLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { Box, Maximize2, Minimize2, RotateCcw, RefreshCw } from "lucide-react";
import { downloadFileBinary } from "../api/files.api";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";

interface ModelViewerProps {
  token: string;
  filePath: string;
}

type ViewerState = "idle" | "loading" | "loaded" | "error";

function getExtension(path: string): string {
  const normalized = path.trim().toLowerCase();
  if (!normalized.includes(".")) {
    return "";
  }
  return normalized.slice(normalized.lastIndexOf("."));
}

function fitCameraToObject(input: {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  object: THREE.Object3D;
}) {
  const box = new THREE.Box3().setFromObject(input.object);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDimension = Math.max(size.x, size.y, size.z);
  const fitDistance = maxDimension > 0 ? maxDimension * 1.8 : 80;

  input.camera.position.set(center.x + fitDistance, center.y + fitDistance, center.z + fitDistance);
  input.camera.near = fitDistance / 100;
  input.camera.far = fitDistance * 100;
  input.camera.updateProjectionMatrix();

  input.controls.target.copy(center);
  input.controls.update();
}

export function ModelViewer({ token, filePath }: ModelViewerProps) {
  const [viewerState, setViewerState] = useState<ViewerState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [isActivated, setIsActivated] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneObjectRef = useRef<THREE.Object3D | null>(null);
  const extension = useMemo(() => getExtension(filePath), [filePath]);

  useEffect(() => {
    setViewerState("idle");
    setErrorMessage("");
    setIsActivated(false);
  }, [filePath]);

  const handleResetCamera = useCallback(() => {
    if (cameraRef.current && controlsRef.current && sceneObjectRef.current) {
      fitCameraToObject({
        camera: cameraRef.current,
        controls: controlsRef.current,
        object: sceneObjectRef.current,
      });
    }
  }, []);

  useEffect(() => {
    if (!isActivated) {
      return;
    }

    if (extension !== ".stl" && extension !== ".3mf") {
      setViewerState("error");
      setErrorMessage(`Preview not supported for ${extension || "this file type"}.`);
      return;
    }

    const host = hostRef.current;
    if (!host) {
      return;
    }

    let disposed = false;
    let animationFrameId = 0;
    let objectUrl = "";
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf8fafc);

    const rect = host.getBoundingClientRect();
    const width = Math.max(rect.width, 200);
    const height = Math.max(rect.height, 200);

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 5000);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    rendererRef.current = renderer;
    host.innerHTML = "";
    host.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controlsRef.current = controls;

    scene.add(new THREE.AmbientLight(0xffffff, 1.4));
    const directionalA = new THREE.DirectionalLight(0xffffff, 1.4);
    directionalA.position.set(2, 3, 2);
    scene.add(directionalA);
    const directionalB = new THREE.DirectionalLight(0xffffff, 1.1);
    directionalB.position.set(-2, -3, -2);
    scene.add(directionalB);

    // ResizeObserver for responsive sizing
    const resizeObserver = new ResizeObserver((entries) => {
      if (disposed) return;
      for (const entry of entries) {
        const { width: w, height: h } = entry.contentRect;
        const nextWidth = Math.max(w, 200);
        const nextHeight = Math.max(h, 200);
        renderer.setSize(nextWidth, nextHeight);
        camera.aspect = nextWidth / nextHeight;
        camera.updateProjectionMatrix();
      }
    });
    resizeObserver.observe(host);

    async function loadObject() {
      setViewerState("loading");
      setErrorMessage("");
      try {
        const downloaded = await downloadFileBinary({
          token,
          path: filePath,
        });

        let meshOrGroup: THREE.Object3D;
        if (extension === ".stl") {
          const buffer = await downloaded.blob.arrayBuffer();
          const geometry = new STLLoader().parse(buffer);
          geometry.computeVertexNormals();
          meshOrGroup = new THREE.Mesh(
            geometry,
            new THREE.MeshStandardMaterial({ color: 0x3f72af, metalness: 0.15, roughness: 0.4 }),
          );
        } else {
          objectUrl = URL.createObjectURL(downloaded.blob);
          meshOrGroup = await new ThreeMFLoader().loadAsync(objectUrl);
        }

        if (disposed) {
          return;
        }

        sceneObjectRef.current = meshOrGroup;
        scene.add(meshOrGroup);
        fitCameraToObject({
          camera,
          controls,
          object: meshOrGroup,
        });

        const animate = () => {
          if (disposed) {
            return;
          }
          controls.update();
          renderer.render(scene, camera);
          animationFrameId = window.requestAnimationFrame(animate);
        };
        animate();
        setViewerState("loaded");
      } catch (error) {
        if (disposed) {
          return;
        }
        setViewerState("error");
        setErrorMessage(error instanceof Error ? error.message : "Failed to render preview.");
      }
    }

    void loadObject();

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      if (animationFrameId) {
        window.cancelAnimationFrame(animationFrameId);
      }
      controls.dispose();
      renderer.dispose();
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.geometry) {
          mesh.geometry.dispose();
        }
        const material = mesh.material;
        if (Array.isArray(material)) {
          material.forEach((entry) => entry.dispose?.());
        } else {
          material?.dispose?.();
        }
      });
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
      host.innerHTML = "";
    };
  }, [extension, filePath, isActivated, token]);

  if (!isActivated) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--surface-2))] p-8">
        <Box className="h-10 w-10 text-[hsl(var(--muted-foreground))]" />
        <p className="text-sm text-[hsl(var(--muted-foreground))]">3D preview available</p>
        <Button
          variant="outline"
          iconLeft={<Box className="h-4 w-4" />}
          onClick={() => setIsActivated(true)}
        >
          Load 3D Preview
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {(viewerState === "loading" || viewerState === "idle") && (
        <div className="space-y-3 p-4">
          <div className="flex items-center gap-2 text-sm text-[hsl(var(--muted-foreground))]">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[hsl(var(--primary))] border-t-transparent" />
            Loading 3D preview...
          </div>
          <Skeleton className="h-[280px] w-full rounded-md" />
        </div>
      )}
      {viewerState === "error" && (
        <div className="flex flex-col items-center gap-3 rounded-md border border-[hsl(var(--destructive)_/_0.3)] bg-[hsl(var(--destructive)_/_0.06)] p-4">
          <p className="text-sm text-[hsl(var(--destructive))]">{errorMessage}</p>
          <Button
            size="sm"
            variant="outline"
            iconLeft={<RefreshCw className="h-3.5 w-3.5" />}
            onClick={() => {
              setIsActivated(false);
              setTimeout(() => setIsActivated(true), 50);
            }}
          >
            Retry
          </Button>
        </div>
      )}
      {/* Viewer toolbar */}
      {viewerState === "loaded" && (
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" iconLeft={<RotateCcw className="h-3.5 w-3.5" />} onClick={handleResetCamera}>
            Reset View
          </Button>
          <Button
            size="sm"
            variant="ghost"
            iconLeft={isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            onClick={() => setIsFullscreen((prev) => !prev)}
          >
            {isFullscreen ? "Exit Fullscreen" : "Expand"}
          </Button>
        </div>
      )}
      <div
        ref={hostRef}
        className={`w-full overflow-hidden rounded-md border border-[hsl(var(--border))] transition-all ${
          isFullscreen ? "h-[70vh]" : "h-[320px]"
        } ${viewerState === "loading" || viewerState === "idle" ? "hidden" : ""}`}
      />
    </div>
  );
}
