import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { ThreeMFLoader } from "three/examples/jsm/loaders/3MFLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { RefreshCw } from "lucide-react";
import { downloadFileBinary } from "../../api/files.api";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";

/* ------------------------------------------------------------------ */
/*  Turntable rotation — exported for property-based testing          */
/* ------------------------------------------------------------------ */

/** Angular velocity: 2π / 12s ≈ 0.5236 rad/s (one revolution in 12s). */
const ROTATION_PERIOD_S = 12;
const ANGULAR_VELOCITY = (2 * Math.PI) / ROTATION_PERIOD_S;

/**
 * Calculate the Z-axis rotation increment for a given frame delta.
 * Returns radians to add to the current rotation.
 *
 * Exported so property tests can verify the speed stays within the
 * 10–15 s/revolution range (2π/15 ≤ v ≤ 2π/10 rad/s).
 */
export function calculateTurntableRotation(deltaMs: number): number {
  const deltaSec = deltaMs / 1000;
  return ANGULAR_VELOCITY * deltaSec;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

const RESUME_DELAY_MS = 2000;

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

export interface InlineModelViewerProps {
  filePath: string;
  token: string;
}

type ViewerState = "loading" | "loaded" | "error";

function getExtension(path: string): string {
  const normalized = path.trim().toLowerCase();
  if (!normalized.includes(".")) return "";
  return normalized.slice(normalized.lastIndexOf("."));
}

function fitCameraToObject(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  object: THREE.Object3D,
) {
  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const fitDist = maxDim > 0 ? maxDim * 1.8 : 80;

  camera.position.set(center.x + fitDist, center.y + fitDist, center.z + fitDist);
  camera.near = fitDist / 100;
  camera.far = fitDist * 100;
  camera.updateProjectionMatrix();

  controls.target.copy(center);
  controls.update();
}

export function InlineModelViewer({ filePath, token }: InlineModelViewerProps) {
  const [viewerState, setViewerState] = useState<ViewerState>("loading");
  const [errorMessage, setErrorMessage] = useState("");

  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneObjectRef = useRef<THREE.Object3D | null>(null);

  /* Turntable state — kept in refs to avoid re-renders on every frame */
  const turntableActiveRef = useRef(true);
  const lastFrameTimeRef = useRef(0);
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ---- Retry handler ---- */

  const retryKeyRef = useRef(0);
  const [retryKey, setRetryKey] = useState(0);

  const handleRetry = useCallback(() => {
    retryKeyRef.current += 1;
    setRetryKey(retryKeyRef.current);
    setViewerState("loading");
    setErrorMessage("");
  }, []);

  /* ---- Main Three.js setup ---- */

  useEffect(() => {
    const ext = getExtension(filePath);
    if (ext !== ".stl" && ext !== ".3mf") {
      setViewerState("error");
      setErrorMessage(`Preview not supported for ${ext || "this file type"}.`);
      return;
    }

    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let animationFrameId = 0;
    let objectUrl = "";

    /* Scene */
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf8fafc);

    const rect = host.getBoundingClientRect();
    const width = Math.max(rect.width, 200);
    const height = Math.max(rect.height, 200);

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 5000);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    host.innerHTML = "";
    host.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;

    /* Lighting */
    scene.add(new THREE.AmbientLight(0xffffff, 1.4));
    const dirA = new THREE.DirectionalLight(0xffffff, 1.4);
    dirA.position.set(2, 3, 2);
    scene.add(dirA);
    const dirB = new THREE.DirectionalLight(0xffffff, 1.1);
    dirB.position.set(-2, -3, -2);
    scene.add(dirB);

    /* Resize observer */
    const resizeObserver = new ResizeObserver((entries) => {
      if (disposed) return;
      for (const entry of entries) {
        const { width: w, height: h } = entry.contentRect;
        const nw = Math.max(w, 200);
        const nh = Math.max(h, 200);
        renderer.setSize(nw, nh);
        camera.aspect = nw / nh;
        camera.updateProjectionMatrix();
      }
    });
    resizeObserver.observe(host);

    /* Interaction listeners — pause turntable on mousedown/touchstart */
    const domEl = renderer.domElement;

    const onInteractionStart = () => {
      turntableActiveRef.current = false;
      if (resumeTimerRef.current !== null) {
        clearTimeout(resumeTimerRef.current);
        resumeTimerRef.current = null;
      }
    };

    const onInteractionEnd = () => {
      if (resumeTimerRef.current !== null) {
        clearTimeout(resumeTimerRef.current);
      }
      resumeTimerRef.current = setTimeout(() => {
        turntableActiveRef.current = true;
        resumeTimerRef.current = null;
      }, RESUME_DELAY_MS);
    };

    domEl.addEventListener("mousedown", onInteractionStart);
    domEl.addEventListener("touchstart", onInteractionStart, { passive: true });
    domEl.addEventListener("mouseup", onInteractionEnd);
    domEl.addEventListener("touchend", onInteractionEnd);

    /* Load model */
    async function loadModel() {
      setViewerState("loading");
      setErrorMessage("");
      try {
        const downloaded = await downloadFileBinary({ token, path: filePath });

        let meshOrGroup: THREE.Object3D;
        if (ext === ".stl") {
          const buffer = await downloaded.blob.arrayBuffer();
          const geometry = new STLLoader().parse(buffer);
          meshOrGroup = new THREE.Mesh(
            geometry,
            new THREE.MeshStandardMaterial({ color: 0x3f72af, metalness: 0.0, roughness: 0.85, flatShading: true }),
          );
        } else {
          objectUrl = URL.createObjectURL(downloaded.blob);
          meshOrGroup = await new ThreeMFLoader().loadAsync(objectUrl);
        }

        if (disposed) return;

        sceneObjectRef.current = meshOrGroup;
        scene.add(meshOrGroup);
        fitCameraToObject(camera, controls, meshOrGroup);

        /* Reset turntable */
        turntableActiveRef.current = true;
        lastFrameTimeRef.current = 0;

        /* Animation loop */
        const animate = (time: number) => {
          if (disposed) return;

          if (lastFrameTimeRef.current > 0 && turntableActiveRef.current && sceneObjectRef.current) {
            const deltaMs = time - lastFrameTimeRef.current;
            sceneObjectRef.current.rotation.z += calculateTurntableRotation(deltaMs);
          }
          lastFrameTimeRef.current = time;

          controls.update();
          renderer.render(scene, camera);
          animationFrameId = window.requestAnimationFrame(animate);
        };
        animationFrameId = window.requestAnimationFrame(animate);
        setViewerState("loaded");
      } catch (err) {
        if (disposed) return;
        setViewerState("error");
        setErrorMessage(err instanceof Error ? err.message : "Failed to load 3D preview.");
      }
    }

    void loadModel();

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      if (animationFrameId) window.cancelAnimationFrame(animationFrameId);
      if (resumeTimerRef.current !== null) clearTimeout(resumeTimerRef.current);

      domEl.removeEventListener("mousedown", onInteractionStart);
      domEl.removeEventListener("touchstart", onInteractionStart);
      domEl.removeEventListener("mouseup", onInteractionEnd);
      domEl.removeEventListener("touchend", onInteractionEnd);

      controls.dispose();
      renderer.dispose();
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose?.());
        else mat?.dispose?.();
      });
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      host.innerHTML = "";
    };
    // retryKey is included so the effect re-runs on retry
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, token, retryKey]);

  return (
    <div
      className="inline-model-viewer w-full max-w-[400px] overflow-hidden rounded-lg border border-[hsl(var(--border))]"
      data-testid="inline-model-viewer"
    >
      {/* Skeleton loading state */}
      {viewerState === "loading" && (
        <div className="space-y-2 p-3" data-testid="inline-viewer-loading">
          <div className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
            <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[hsl(var(--primary))] border-t-transparent" />
            Loading 3D preview…
          </div>
          <Skeleton className="h-[240px] w-full rounded-md" />
        </div>
      )}

      {/* Error state with retry */}
      {viewerState === "error" && (
        <div
          className="flex flex-col items-center gap-2 p-4"
          data-testid="inline-viewer-error"
        >
          <p className="text-sm text-[hsl(var(--destructive))]">{errorMessage}</p>
          <Button
            size="sm"
            variant="outline"
            iconLeft={<RefreshCw className="h-3.5 w-3.5" />}
            onClick={handleRetry}
          >
            Retry
          </Button>
        </div>
      )}

      {/* Three.js canvas host */}
      <div
        ref={hostRef}
        className={`h-[260px] w-full ${viewerState === "loaded" ? "" : "hidden"}`}
        data-testid="inline-viewer-canvas"
      />
    </div>
  );
}
