<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from "vue";

import OpenSeadragon from "openseadragon";
import { createOSDAnnotator, W3CImageFormat } from "@annotorious/openseadragon";
import "@annotorious/openseadragon/annotorious-openseadragon.css";

import ComparisonControls from "@/iiifrecon/iiif/ComparisonControls.vue";
import { toggleFullscreen } from "@/iiifrecon/iiif/fullscreen.ts";
import { getInfoJsonUrl } from "@/iiifrecon/iiif/manifest.ts";

import type {
    ImageAnnotation,
    OpenSeadragonAnnotator,
    W3CImageAnnotation,
} from "@annotorious/openseadragon";
import type {
    CanvasInfo,
    DrawingToolName,
    ViewerCommand,
} from "@/iiifrecon/iiif/types.ts";

const LOG_PREFIX = "[OpenSeadragon]";

const baseCanvas = ref<CanvasInfo | null>(null);
const overlayCanvas = ref<CanvasInfo | null>(null);
const overlayOpacity = ref(0.5);
const overlayVisible = ref(true);
const drawingTool = ref<DrawingToolName>("none");

const rootElement = useTemplateRef<HTMLDivElement>("rootElement");
const viewerElement = useTemplateRef<HTMLDivElement>("viewerElement");

// Library instances are kept out of Vue's reactivity system on purpose.
let viewer: OpenSeadragon.Viewer | null = null;
let annotator: OpenSeadragonAnnotator<
    ImageAnnotation,
    W3CImageAnnotation
> | null = null;
let overlayItem: OpenSeadragon.TiledImage | null = null;
let overlayRequest = 0;

function getTileSource(canvas: CanvasInfo) {
    return (
        getInfoJsonUrl(canvas) ?? {
            type: "image",
            url: canvas.imageUrl,
            crossOriginPolicy: "Anonymous",
        }
    );
}

// Annotorious assumes a single image: it converts pointer positions through
// the viewport and scales its drawing layer by world.getContentFactor(). Once
// the overlay makes the world multi-image, the viewport falls back to
// whole-world math (and logs an error) and the content factor becomes the
// highest-resolution image's. Pin both to the base image, world item 0, so
// shapes stay under the cursor and are recorded in base canvas pixels.
function pinCoordinatesToBaseImage(osdViewer: OpenSeadragon.Viewer) {
    const { viewport, world } = osdViewer;
    const {
        viewportToImageCoordinates,
        imageToViewportCoordinates,
        viewportToImageRectangle,
        imageToViewportRectangle,
    } = viewport;
    const getWorldContentFactor = world.getContentFactor.bind(world);
    const getBaseItem = () => world.getItemAt(0);

    world.getContentFactor = () => {
        const baseItem = getBaseItem();
        return baseItem
            ? baseItem.getContentSize().x / baseItem.getBounds().width
            : getWorldContentFactor();
    };
    const toPoint = (x: number | OpenSeadragon.Point, y?: number) =>
        x instanceof OpenSeadragon.Point ? x : new OpenSeadragon.Point(x, y);
    const toRect = (
        x: number | OpenSeadragon.Rect,
        y?: number,
        width?: number,
        height?: number,
    ) =>
        x instanceof OpenSeadragon.Rect
            ? x
            : new OpenSeadragon.Rect(x, y ?? 0, width ?? 0, height ?? 0);

    viewport.viewportToImageCoordinates = (
        x: number | OpenSeadragon.Point,
        y?: number,
    ) => {
        const point = toPoint(x, y);
        return (
            getBaseItem()?.viewportToImageCoordinates(point.x, point.y, true) ??
            viewportToImageCoordinates.call(viewport, point)
        );
    };
    viewport.imageToViewportCoordinates = (
        x: number | OpenSeadragon.Point,
        y?: number,
    ) => {
        const point = toPoint(x, y);
        return (
            getBaseItem()?.imageToViewportCoordinates(point.x, point.y, true) ??
            imageToViewportCoordinates.call(viewport, point)
        );
    };
    viewport.viewportToImageRectangle = (
        x: number | OpenSeadragon.Rect,
        y?: number,
        width?: number,
        height?: number,
    ) => {
        const rect = toRect(x, y, width, height);
        return (
            getBaseItem()?.viewportToImageRectangle(
                rect.x,
                rect.y,
                rect.width,
                rect.height,
                true,
            ) ?? viewportToImageRectangle.call(viewport, rect)
        );
    };
    viewport.imageToViewportRectangle = (
        x: number | OpenSeadragon.Rect,
        y?: number,
        width?: number,
        height?: number,
    ) => {
        const rect = toRect(x, y, width, height);
        return (
            getBaseItem()?.imageToViewportRectangle(
                rect.x,
                rect.y,
                rect.width,
                rect.height,
                true,
            ) ?? imageToViewportRectangle.call(viewport, rect)
        );
    };
}

function getEffectiveOpacity() {
    return overlayVisible.value ? overlayOpacity.value : 0;
}

function createAnnotator(canvas: CanvasInfo) {
    annotator?.destroy();
    annotator = createOSDAnnotator<ImageAnnotation, W3CImageAnnotation>(
        viewer!,
        {
            adapter: W3CImageFormat(canvas.id),
        },
    );
    applyDrawingTool(drawingTool.value);
    annotator.on("createAnnotation", (annotation) =>
        console.log(LOG_PREFIX, "createAnnotation", annotation),
    );
    annotator.on("updateAnnotation", (annotation, previous) =>
        console.log(LOG_PREFIX, "updateAnnotation", annotation, previous),
    );
    annotator.on("deleteAnnotation", (annotation) =>
        console.log(LOG_PREFIX, "deleteAnnotation", annotation),
    );
}

function applyDrawingTool(tool: DrawingToolName) {
    if (!annotator) {
        return;
    }
    // With drawing enabled, dragging draws instead of panning.
    annotator.setDrawingEnabled(tool !== "none");
    if (tool !== "none") {
        annotator.setDrawingTool(tool);
    }
}

function removeOverlay() {
    overlayRequest++;
    if (overlayItem && viewer) {
        viewer.world.removeItem(overlayItem);
    }
    overlayItem = null;
}

function addOverlay() {
    removeOverlay();
    if (!viewer || !overlayCanvas.value || !baseCanvas.value) {
        return;
    }
    const request = overlayRequest;
    // width: 1 matches the base image, so canvases of different resolutions line up.
    viewer.addTiledImage({
        tileSource: getTileSource(overlayCanvas.value),
        index: 1,
        x: 0,
        y: 0,
        width: 1,
        opacity: getEffectiveOpacity(),
        success: (event) => {
            const item = (
                event as unknown as { item: OpenSeadragon.TiledImage }
            ).item;
            if (request !== overlayRequest) {
                viewer?.world.removeItem(item);
                return;
            }
            overlayItem = item;
        },
        error: (event) =>
            console.error(LOG_PREFIX, "Failed to open overlay", event),
    });
}

function openBaseCanvas(canvas: CanvasInfo | null) {
    if (!viewer) {
        return;
    }
    removeOverlay();
    if (!canvas) {
        viewer.close();
        return;
    }
    viewer.addOnceHandler("open", () => {
        // A handler left behind by a failed open must not act on a later one.
        if (canvas !== baseCanvas.value) {
            return;
        }
        createAnnotator(canvas);
        addOverlay();
    });
    viewer.addOnceHandler("open-failed", (event) =>
        console.error(LOG_PREFIX, "Failed to open base canvas", event),
    );
    viewer.open({ tileSource: getTileSource(canvas) });
}

function rotateBy(degrees: number) {
    const viewport = viewer!.viewport;
    viewport.setRotation(viewport.getRotation() + degrees);
}

function onCommand(command: ViewerCommand) {
    if (!viewer) {
        return;
    }
    switch (command) {
        case "zoomIn":
            viewer.viewport.zoomBy(1.5);
            break;
        case "zoomOut":
            viewer.viewport.zoomBy(1 / 1.5);
            break;
        case "home":
            viewer.viewport.setRotation(0);
            viewer.viewport.goHome();
            break;
        case "rotateLeft":
            rotateBy(-90);
            break;
        case "rotateRight":
            rotateBy(90);
            break;
        case "fullscreen":
            toggleFullscreen(rootElement.value!);
            break;
        case "logAnnotations":
            console.log(
                LOG_PREFIX,
                "annotations",
                annotator?.getAnnotations() ?? [],
            );
            break;
        case "clearAnnotations":
            annotator?.clearAnnotations();
            break;
    }
}

function onKeydown(event: KeyboardEvent) {
    if (!annotator || !["Delete", "Backspace"].includes(event.key)) {
        return;
    }
    const target = event.target as HTMLElement | null;
    if (target?.closest("input, textarea, [contenteditable]")) {
        return;
    }
    annotator
        .getSelected()
        .forEach((annotation) => annotator!.removeAnnotation(annotation.id));
}

watch(baseCanvas, openBaseCanvas);
watch(overlayCanvas, addOverlay);
watch([overlayOpacity, overlayVisible], () =>
    overlayItem?.setOpacity(getEffectiveOpacity()),
);
watch(drawingTool, applyDrawingTool);

onMounted(() => {
    viewer = OpenSeadragon({
        element: viewerElement.value!,
        crossOriginPolicy: "Anonymous",
        showNavigationControl: false,
        showNavigator: true,
        navigatorPosition: "BOTTOM_RIGHT",
        // Allow zooming well past native resolution for close inspection.
        maxZoomPixelRatio: 8,
        visibilityRatio: 0.5,
        gestureSettingsMouse: { clickToZoom: false },
    });
    pinCoordinatesToBaseImage(viewer);
    window.addEventListener("keydown", onKeydown);
    openBaseCanvas(baseCanvas.value);
});

onBeforeUnmount(() => {
    window.removeEventListener("keydown", onKeydown);
    annotator?.destroy();
    viewer?.destroy();
    annotator = null;
    viewer = null;
});
</script>

<template>
    <div
        ref="rootElement"
        class="osd-comparison-viewer"
    >
        <ComparisonControls
            v-model:base-canvas="baseCanvas"
            v-model:overlay-canvas="overlayCanvas"
            v-model:overlay-opacity="overlayOpacity"
            v-model:overlay-visible="overlayVisible"
            v-model:drawing-tool="drawingTool"
            @command="onCommand"
        />
        <div
            ref="viewerElement"
            class="viewer"
        />
    </div>
</template>

<style scoped>
.osd-comparison-viewer {
    display: flex;
    flex-direction: column;
    height: 100%;
}

.viewer {
    flex: 1;
    min-height: 0;
    background: #1e1e1e;
}
</style>
