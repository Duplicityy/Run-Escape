import { Camera } from "../../mapviewer/Camera";
import { RS_TO_RADIANS } from "../../rs/MathConstants";

const MIN_DISTANCE = 10;
export const MAX_CAMERA_DISTANCE = 44;

// How far along the ground the camera is from what it looks at, in tiles
export function getGroundReach(pitch: number, distance: number): number {
    return Math.abs(Math.cos(pitch * RS_TO_RADIANS)) * distance;
}

// A fixed top-down camera that keeps a target point in the middle of the screen.
export class CameraRig {
    // RS angle units (2048 per turn): pitch -512 looks straight down, yaw 0 faces north
    pitch = -400;
    yaw = 0;
    fov = 45;
    // Tiles from the camera to the target
    distance = 22;

    zoom(steps: number): void {
        this.distance = Math.min(
            Math.max(this.distance * Math.pow(1.1, steps), MIN_DISTANCE),
            MAX_CAMERA_DISTANCE,
        );
    }

    // x/z in world tiles, y in world tiles with up negative.
    apply(camera: Camera, targetX: number, targetY: number, targetZ: number): void {
        // The camera looks down -z in its own space; Camera.update turns that by
        // yaw - 1024 around y after a half turn roll and the pitch.
        const pitch = this.pitch * RS_TO_RADIANS;
        const yaw = (this.yaw - 1024) * RS_TO_RADIANS;
        const forwardX = -Math.cos(pitch) * Math.sin(yaw);
        const forwardY = -Math.sin(pitch);
        const forwardZ = -Math.cos(pitch) * Math.cos(yaw);

        const posX = targetX - forwardX * this.distance;
        const posY = targetY - forwardY * this.distance;
        const posZ = targetZ - forwardZ * this.distance;

        const moved = camera.pos[0] !== posX || camera.pos[1] !== posY || camera.pos[2] !== posZ;
        camera.pos[0] = posX;
        camera.pos[1] = posY;
        camera.pos[2] = posZ;
        camera.pitch = this.pitch;
        camera.yaw = this.yaw;
        camera.fov = this.fov;
        if (moved) {
            camera.updated = true;
            camera.updatedPosition = true;
        }
    }
}
