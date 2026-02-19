import * as THREE from 'three';
import { getUrl } from 'aws-amplify/storage';
import { useEffect, useRef, useState } from "react";
import { ThreeMFLoader } from 'three/addons/loaders/3MFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Progress } from 'semantic-ui-react';
import { useResponsiveness } from "react-responsiveness";

interface ModelViewerProps {
    fileName: string;
}

const ModelViewer: React.FC<ModelViewerProps> = ({ fileName }) => {
  const refContainer = useRef<HTMLDivElement>(null);
  const refFilename = useRef<string>("");
  const [progress, setProgress] = useState(0);
  const { currentInterval } = useResponsiveness()
  const [currentScreenSize, setCurrentScreenSize] = useState<string>("");
  const [lastScreenSize, setLastScreenSize] = useState<string>("");
  const [renderer, setRenderer] = useState<THREE.WebGLRenderer | null>(null);

    async function loadFile(url: string ) {
        const linkToStorageFile = await getUrl({
            path: url,
        });
        const downloadUrl = linkToStorageFile.url.toString();
        const manager = new THREE.LoadingManager();
        const loader = new ThreeMFLoader(manager);

        // === THREE.JS CODE START ===
        var scene = new THREE.Scene();
        scene.background = new THREE.Color(0x404040)

        var camera = new THREE.PerspectiveCamera();
        var renderer = new THREE.WebGLRenderer();

        if(currentInterval === "xs")
            renderer.setSize(256, 256);
        else
            renderer.setSize(512, 512);
        setRenderer(renderer);
        // document.body.appendChild( renderer.domElement );
        // use ref as a mount point of the Three.js scene instead of the document.body
        refContainer.current && refContainer.current.appendChild( renderer.domElement );
        scene.add( new THREE.AmbientLight( 0xffffff, 1 ) );

        const light = new THREE.DirectionalLight( 0xffffff, 2 );
        light.position.set( - 1, - 2.5, 1 );
        scene.add( light );

        const secondlight = new THREE.DirectionalLight( 0xffffff, 2 );
        light.position.set( 1, 2.5, 1 );
        scene.add( secondlight );

        const controls = new OrbitControls( camera, renderer.domElement );
        controls.autoRotate = true;
        controls.enableDamping = true
        controls.dampingFactor = 0.05
        controls.update();

        loader.load(
            downloadUrl,
            (object) => {
                // Convert from Z-up to Y-up coordinate system if needed
                object.quaternion.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0))
                scene.add(object);

                // Get the bounding box of your loaded object
                const boundingBox = new THREE.Box3().setFromObject(object)
                const center = new THREE.Vector3()
                boundingBox.getCenter(center)

                // Calculate dimensions and diagonal
                const dimensions = new THREE.Vector3()
                boundingBox.getSize(dimensions)
                const diagonal = Math.sqrt(
                    dimensions.x * dimensions.x + 
                    dimensions.y * dimensions.y + 
                    dimensions.z * dimensions.z
                )

                // Calculate camera distance based on field of view
                const fov = camera.fov // degrees
                const cameraDistance = diagonal / (2 * Math.tan((fov * Math.PI) / 360))

                // Position camera
                //camera.position.set(0, 0, cameraDistance)
                // Position camera at an angle (45 degrees from top)
                const angle = Math.PI / 4 // 45 degrees
                camera.position.set(
                    center.x + cameraDistance * Math.sin(angle),
                    center.y + cameraDistance * Math.sin(angle),
                    center.z + cameraDistance * Math.cos(angle)
                )
                camera.lookAt(center)
                controls.target.copy(center) // Set orbit center to object's center

                var animate = function () {
                    requestAnimationFrame(animate);
                    //object.rotation.x += 0.01;
                    //object.rotation.z += 0.01;
                    controls.update();
                    renderer.render(scene, camera);
                };
                animate();
            },
            (xhr) => {
                setProgress((xhr.loaded / xhr.total) * 100);
                //console.log((xhr.loaded / xhr.total) * 100 + '% loaded')
            },
            (error) => {
                console.error(error)
            }
        )
    }

    useEffect(() => {
        if(refFilename.current === fileName) return;
        refFilename.current = fileName;

        loadFile(fileName);

    }, [fileName]);

    useEffect(() => {
        if(currentInterval !== currentScreenSize)
        {
            setLastScreenSize(currentScreenSize);
            setCurrentScreenSize(currentInterval);
        }
    }, [currentInterval]);

    useEffect(() => {
        if(currentScreenSize === "xs" && lastScreenSize !== "xs")
        {
            if(renderer)
            {
                renderer.setSize(256, 256);
                if(refContainer.current)
                    refContainer.current.style.width = "256px";
                if(refContainer.current)
                    refContainer.current.style.height = "256px";
            }
        }
        if((lastScreenSize === "xs" && currentScreenSize !== "xs") || (lastScreenSize === "" && currentScreenSize !== "xs"))
        {
            if(renderer)
                {
                    renderer.setSize(512, 512);
                    if(refContainer.current)
                        refContainer.current.style.width = "512px";
                    if(refContainer.current)
                        refContainer.current.style.height = "512px";
                }
        }

    }, [currentScreenSize]);

  return (
    <>
        { progress<100 ? <Progress percent={progress} indicating>Loading model</Progress> : <></>}
        <div ref={refContainer}></div>
    </>
  );
}

export default ModelViewer