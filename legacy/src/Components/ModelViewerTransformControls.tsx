import * as THREE from 'three';
import { getUrl } from 'aws-amplify/storage';
import { useEffect, useRef } from "react";
import { ThreeMFLoader } from 'three/addons/loaders/3MFLoader.js';
//import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
interface ModelViewerProps {
    fileName: string;
}

const ModelViewer: React.FC<ModelViewerProps> = ({ fileName }) => {
  const refContainer = useRef<HTMLDivElement>(null);
  const refFilename = useRef<string>("");

    async function loadFile(url: string ) {
        const linkToStorageFile = await getUrl({
            path: url,
        });
        const downloadUrl = linkToStorageFile.url.toString();
        const manager = new THREE.LoadingManager();
        const loader = new ThreeMFLoader(manager);

        // === THREE.JS CODE START ===
        var scene = new THREE.Scene();
        var camera = new THREE.PerspectiveCamera();
        var renderer = new THREE.WebGLRenderer();

        renderer.setSize(256, 256);
        // document.body.appendChild( renderer.domElement );
        // use ref as a mount point of the Three.js scene instead of the document.body
        refContainer.current && refContainer.current.appendChild( renderer.domElement );
        scene.add( new THREE.AmbientLight( 0xffffff, 0.6 ) );

        const light = new THREE.DirectionalLight( 0xffffff, 2 );
        light.position.set( - 1, - 2.5, 1 );
        scene.add( light );

        // const controls = new OrbitControls( camera, renderer.domElement );
        // controls.autoRotate = true;
        // controls.enableDamping = true
        // controls.dampingFactor = 0.05
        // controls.update();

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

                // new: Center the object at origin
                object.position.sub(center)

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

                // new: Position camera at an angle (45 degrees from top)
                camera.position.set(0, 0, cameraDistance)
                camera.lookAt(0, 0, 0)

                // Create transform controls
                const controls = new TransformControls(camera, renderer.domElement);
                controls.attach(object);
                controls.setMode('rotate'); // Set to rotation mode
                scene.add(controls.getHelper());

                // Position camera
                //camera.position.set(0, 0, cameraDistance)
                // Position camera at an angle (45 degrees from top)
                // const angle = Math.PI / 4 // 45 degrees
                // camera.position.set(
                //     center.x + cameraDistance * Math.sin(angle),
                //     center.y + cameraDistance * Math.sin(angle),
                //     center.z + cameraDistance * Math.cos(angle)
                // )
                // camera.lookAt(center)
                // controls.target.copy(center) // Set orbit center to object's center

                var animate = function () {
                    requestAnimationFrame(animate);
                    //object.rotation.x += 0.01;
                    //object.rotation.z += 0.01;
                    //controls.update();
                    renderer.render(scene, camera);
                };
                animate();
            },
            () => {
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
  return (
    <div ref={refContainer}></div>
  );
}

export default ModelViewer