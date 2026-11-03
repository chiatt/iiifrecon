<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from "vue";

import OlMap from "ol/Map.js";
import View from "ol/View.js";
import GeoJSON from "ol/format/GeoJSON.js";
import IIIFInfo from "ol/format/IIIFInfo.js";
import Draw, { createBox } from "ol/interaction/Draw.js";
import Modify from "ol/interaction/Modify.js";
import Select from "ol/interaction/Select.js";
import ImageLayer from "ol/layer/Image.js";
import TileLayer from "ol/layer/Tile.js";
import VectorLayer from "ol/layer/Vector.js";
import { addCoordinateTransforms, Projection } from "ol/proj.js";
import IIIF from "ol/source/IIIF.js";
import Static from "ol/source/ImageStatic.js";
import VectorSource from "ol/source/Vector.js";
import "ol/ol.css";

import ComparisonControls from "@/iiifrecon/iiif/ComparisonControls.vue";
import { toggleFullscreen } from "@/iiifrecon/iiif/fullscreen.ts";
import { fetchImageInfo } from "@/iiifrecon/iiif/manifest.ts";

import type Feature from "ol/Feature.js";
import type BaseLayer from "ol/layer/Base.js";
import type { Extent } from "ol/extent.js";
import type { Geometry } from "ol/geom.js";
import type {
    CanvasInfo,
    DrawingToolName,
    ViewerCommand,
} from "@/iiifrecon/iiif/types.ts";

const LOG_PREFIX = "[OpenLayers]";
const MAX_OVERZOOM = 8;

const baseCanvas = ref<CanvasInfo | null>(null);
const overlayCanvas = ref<CanvasInfo | null>(null);
const overlayOpacity = ref(0.5);
const overlayVisible = ref(true);
const drawingTool = ref<DrawingToolName>("none");

const rootElement = useTemplateRef<HTMLDivElement>("rootElement");
const viewerElement = useTemplateRef<HTMLDivElement>("viewerElement");

// Library instances are kept out of Vue's reactivity system on purpose.
let map: OlMap | null = null;
let baseLayer: BaseLayer | null = null;
let baseProjection: Projection | null = null;
let baseExtent: Extent | null = null;
let overlayLayer: BaseLayer | null = null;
let drawInteraction: Draw | null = null;
let projectionCount = 0;
let loadRequest = 0;

const annotationSource = new VectorSource<Feature<Geometry>>();
const annotationLayer = new VectorLayer({
    source: annotationSource,
    zIndex: 10,
});
const selectInteraction = new Select({ layers: [annotationLayer] });
const modifyInteraction = new Modify({
    features: selectInteraction.getFeatures(),
});
const geoJSON = new GeoJSON();

// Image pixels map to [x, -y] so the image sits in the top-right quadrant like
// ol/source/IIIF expects; flip y back when reporting canvas coordinates.
function getPixelExtent(canvas: CanvasInfo): Extent {
    return [0, -canvas.height, canvas.width, 0];
}

function createPixelProjection(extent: Extent) {
    return new Projection({
        code: `iiif-pixels-${projectionCount++}`,
        units: "pixels",
        extent,
    });
}

async function createImageLayer(canvas: CanvasInfo, projection: Projection) {
    if (!canvas.imageServiceUrl) {
        return new ImageLayer({
            source: new Static({
                url: canvas.imageUrl,
                imageExtent: getPixelExtent(canvas),
                projection,
                crossOrigin: "anonymous",
            }),
        });
    }
    const info = await fetchImageInfo(canvas);
    const options = new IIIFInfo(info).getTileSourceOptions();
    if (!options) {
        throw new Error(`Unsupported image service: ${canvas.imageServiceUrl}`);
    }
    return new TileLayer({
        source: new IIIF({
            ...options,
            projection,
            crossOrigin: "anonymous",
            zDirection: -1,
        }),
    });
}

function getEffectiveOpacity() {
    return overlayVisible.value ? overlayOpacity.value : 0;
}

function syncLayers() {
    map?.setLayers(
        [baseLayer, overlayLayer, annotationLayer].filter(
            (layer): layer is BaseLayer => layer !== null,
        ),
    );
}

function fitToImage() {
    const view = map?.getView();
    if (view && baseExtent) {
        view.setRotation(0);
        view.fit(baseExtent, { padding: [20, 20, 20, 20] });
    }
}

async function openBaseCanvas(canvas: CanvasInfo | null) {
    const request = ++loadRequest;
    annotationSource.clear();
    selectInteraction.getFeatures().clear();
    baseLayer = null;
    overlayLayer = null;
    syncLayers();
    if (!map || !canvas) {
        return;
    }
    const extent = getPixelExtent(canvas);
    const projection = createPixelProjection(extent);
    try {
        const layer = await createImageLayer(canvas, projection);
        if (request !== loadRequest) {
            return;
        }
        baseLayer = layer;
        baseProjection = projection;
        baseExtent = extent;
    } catch (error) {
        console.error(LOG_PREFIX, "Failed to open base canvas", error);
        return;
    }

    const longestSide = Math.max(canvas.width, canvas.height);
    map.setView(
        new View({
            projection,
            extent,
            constrainOnlyCenter: true,
            showFullExtent: true,
            maxResolution: longestSide / 128,
            // Allow zooming well past native resolution for close inspection.
            minResolution: 1 / MAX_OVERZOOM,
        }),
    );
    syncLayers();
    fitToImage();
    await openOverlayCanvas(overlayCanvas.value);
}

async function openOverlayCanvas(canvas: CanvasInfo | null) {
    const request = loadRequest;
    overlayLayer = null;
    syncLayers();
    if (!map || !canvas || !baseCanvas.value || !baseProjection) {
        return;
    }

    // Scale the overlay to the base image's width so different resolutions
    // line up; OpenLayers reprojects the tiles through this transform.
    const scale = baseCanvas.value.width / canvas.width;
    let projection = baseProjection;
    if (scale !== 1) {
        projection = createPixelProjection(getPixelExtent(canvas));
        addCoordinateTransforms(
            projection,
            baseProjection,
            ([x, y]) => [x * scale, y * scale],
            ([x, y]) => [x / scale, y / scale],
        );
    }

    try {
        const layer = await createImageLayer(canvas, projection);
        if (request !== loadRequest || canvas !== overlayCanvas.value) {
            return;
        }
        layer.setOpacity(getEffectiveOpacity());
        overlayLayer = layer;
        syncLayers();
    } catch (error) {
        console.error(LOG_PREFIX, "Failed to open overlay", error);
    }
}

function setDrawingTool(tool: DrawingToolName) {
    if (drawInteraction) {
        map?.removeInteraction(drawInteraction);
        drawInteraction = null;
    }
    selectInteraction.setActive(tool === "none");
    if (tool === "none" || !map) {
        return;
    }
    selectInteraction.getFeatures().clear();
    drawInteraction =
        tool === "rectangle"
            ? new Draw({
                  source: annotationSource,
                  type: "Circle",
                  geometryFunction: createBox(),
              })
            : new Draw({ source: annotationSource, type: "Polygon" });
    map.addInteraction(drawInteraction);
}

function flipY(coordinates: unknown): unknown {
    if (typeof (coordinates as number[])[0] === "number") {
        const [x, y] = coordinates as number[];
        return [x, -y];
    }
    return (coordinates as unknown[]).map(flipY);
}

function toCanvasFeature(feature: Feature<Geometry>) {
    const geoJSONFeature = geoJSON.writeFeatureObject(feature);
    const geometry = geoJSONFeature.geometry as {
        coordinates: unknown;
    } | null;
    if (geometry) {
        geometry.coordinates = flipY(geometry.coordinates);
    }
    geoJSONFeature.properties = {
        ...geoJSONFeature.properties,
        canvas: baseCanvas.value?.id,
        manifest: baseCanvas.value?.manifestId,
    };
    return geoJSONFeature;
}

function toFeatureCollection(features: Feature<Geometry>[]) {
    return {
        type: "FeatureCollection",
        features: features.map(toCanvasFeature),
    };
}

function logAnnotations(action: string, features: Feature<Geometry>[]) {
    console.log(LOG_PREFIX, action, toFeatureCollection(features));
}

annotationSource.on("addfeature", (event) => {
    event.feature!.setId(crypto.randomUUID());
    logAnnotations("createAnnotation", [event.feature!]);
});
annotationSource.on("removefeature", (event) =>
    logAnnotations("deleteAnnotation", [event.feature!]),
);
modifyInteraction.on("modifyend", (event) =>
    logAnnotations("updateAnnotation", event.features.getArray()),
);

function rotateBy(radians: number) {
    const view = map!.getView();
    view.animate({ rotation: view.getRotation() + radians, duration: 250 });
}

function zoomBy(delta: number) {
    const view = map!.getView();
    view.animate({ zoom: (view.getZoom() ?? 0) + delta, duration: 250 });
}

function onCommand(command: ViewerCommand) {
    if (!map) {
        return;
    }
    switch (command) {
        case "zoomIn":
            zoomBy(1);
            break;
        case "zoomOut":
            zoomBy(-1);
            break;
        case "home":
            fitToImage();
            break;
        case "rotateLeft":
            rotateBy(-Math.PI / 2);
            break;
        case "rotateRight":
            rotateBy(Math.PI / 2);
            break;
        case "fullscreen":
            toggleFullscreen(rootElement.value!);
            break;
        case "logAnnotations":
            logAnnotations("annotations", annotationSource.getFeatures());
            break;
        case "clearAnnotations":
            selectInteraction.getFeatures().clear();
            annotationSource.clear();
            break;
    }
}

function onKeydown(event: KeyboardEvent) {
    if (!["Delete", "Backspace"].includes(event.key)) {
        return;
    }
    const target = event.target as HTMLElement | null;
    if (target?.closest("input, textarea, [contenteditable]")) {
        return;
    }
    const selected = selectInteraction.getFeatures();
    selected.forEach((feature) => annotationSource.removeFeature(feature));
    selected.clear();
}

watch(baseCanvas, openBaseCanvas);
watch(overlayCanvas, openOverlayCanvas);
watch([overlayOpacity, overlayVisible], () =>
    overlayLayer?.setOpacity(getEffectiveOpacity()),
);
watch(drawingTool, setDrawingTool);

onMounted(() => {
    map = new OlMap({
        target: viewerElement.value!,
        controls: [],
        layers: [annotationLayer],
    });
    map.addInteraction(selectInteraction);
    map.addInteraction(modifyInteraction);
    setDrawingTool(drawingTool.value);
    window.addEventListener("keydown", onKeydown);
    openBaseCanvas(baseCanvas.value);
});

onBeforeUnmount(() => {
    window.removeEventListener("keydown", onKeydown);
    map?.setTarget(undefined);
    map = null;
});
</script>

<template>
    <div
        ref="rootElement"
        class="ol-comparison-viewer"
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
.ol-comparison-viewer {
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
