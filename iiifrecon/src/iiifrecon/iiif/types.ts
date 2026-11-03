export interface CanvasInfo {
    id: string;
    label: string;
    width: number;
    height: number;
    manifestId: string;
    imageUrl: string;
    imageServiceUrl?: string;
    imageApiVersion?: 2 | 3;
}

export interface ManifestInfo {
    id: string;
    label: string;
    canvases: CanvasInfo[];
}

export type DrawingToolName = "none" | "rectangle" | "polygon";

export type ViewerCommand =
    | "zoomIn"
    | "zoomOut"
    | "home"
    | "rotateLeft"
    | "rotateRight"
    | "fullscreen"
    | "logAnnotations"
    | "clearAnnotations";
