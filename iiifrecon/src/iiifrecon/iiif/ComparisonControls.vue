<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

import { useGettext } from "vue3-gettext";

import Button from "openvue/button";
import InputText from "openvue/inputtext";
import Message from "openvue/message";
import Select from "openvue/select";
import SelectButton from "openvue/selectbutton";
import Slider from "openvue/slider";
import ToggleButton from "openvue/togglebutton";

import { loadManifest } from "@/iiifrecon/iiif/manifest.ts";

import type {
    CanvasInfo,
    DrawingToolName,
    ManifestInfo,
    ViewerCommand,
} from "@/iiifrecon/iiif/types.ts";

const DEFAULT_MANIFEST_URL =
    "https://iiif.io/api/cookbook/recipe/0009-book-1/manifest.json";

const { $gettext } = useGettext();

const baseCanvas = defineModel<CanvasInfo | null>("baseCanvas", {
    default: null,
});
const overlayCanvas = defineModel<CanvasInfo | null>("overlayCanvas", {
    default: null,
});
const overlayOpacity = defineModel<number>("overlayOpacity", {
    default: 0.5,
});
const overlayVisible = defineModel<boolean>("overlayVisible", {
    default: true,
});
const drawingTool = defineModel<DrawingToolName>("drawingTool", {
    default: "none",
});

const emit = defineEmits<{
    command: [command: ViewerCommand];
}>();

const manifestUrl = ref(DEFAULT_MANIFEST_URL);
const overlayManifestUrl = ref("");
const baseManifest = ref<ManifestInfo | null>(null);
const overlayManifest = ref<ManifestInfo | null>(null);
const isLoading = ref(false);
const errorMessage = ref<string | null>(null);

const overlayCanvasOptions = computed(
    () => overlayManifest.value?.canvases ?? baseManifest.value?.canvases ?? [],
);

const opacityPercent = computed({
    get: () => Math.round(overlayOpacity.value * 100),
    set: (value: number) => {
        overlayOpacity.value = value / 100;
    },
});

const drawingToolOptions = [
    { label: $gettext("Pan / select"), value: "none" },
    { label: $gettext("Rectangle"), value: "rectangle" },
    { label: $gettext("Polygon"), value: "polygon" },
];

const commandButtons: {
    command: ViewerCommand;
    icon: string;
    label: string;
}[] = [
    {
        command: "zoomIn",
        icon: "pi pi-search-plus",
        label: $gettext("Zoom in"),
    },
    {
        command: "zoomOut",
        icon: "pi pi-search-minus",
        label: $gettext("Zoom out"),
    },
    { command: "home", icon: "pi pi-home", label: $gettext("Reset view") },
    {
        command: "rotateLeft",
        icon: "pi pi-replay",
        label: $gettext("Rotate left"),
    },
    {
        command: "rotateRight",
        icon: "pi pi-refresh",
        label: $gettext("Rotate right"),
    },
    {
        command: "fullscreen",
        icon: "pi pi-window-maximize",
        label: $gettext("Fullscreen"),
    },
];

async function withLoading(load: () => Promise<void>) {
    isLoading.value = true;
    errorMessage.value = null;
    try {
        await load();
    } catch (error) {
        errorMessage.value = (error as Error).message;
    } finally {
        isLoading.value = false;
    }
}

function onLoadManifest() {
    return withLoading(async () => {
        const manifest = await loadManifest(manifestUrl.value.trim());
        baseManifest.value = manifest;
        baseCanvas.value = manifest.canvases[0];
        if (!overlayManifest.value) {
            overlayCanvas.value = null;
        }
    });
}

function onLoadOverlayManifest() {
    const url = overlayManifestUrl.value.trim();
    if (!url) {
        overlayManifest.value = null;
        overlayCanvas.value = null;
        return;
    }
    return withLoading(async () => {
        const manifest = await loadManifest(url);
        overlayManifest.value = manifest;
        overlayCanvas.value = manifest.canvases[0];
    });
}

onMounted(onLoadManifest);
</script>

<template>
    <div class="comparison-controls">
        <div class="controls-row">
            <InputText
                v-model="manifestUrl"
                class="url-input"
                :placeholder="$gettext('Manifest URL')"
                @keyup.enter="onLoadManifest"
            />
            <Button
                :label="$gettext('Load')"
                :loading="isLoading"
                @click="onLoadManifest"
            />
            <Select
                v-model="baseCanvas"
                class="canvas-select"
                :options="baseManifest?.canvases ?? []"
                option-label="label"
                :placeholder="$gettext('Base canvas')"
            />
        </div>

        <div class="controls-row">
            <InputText
                v-model="overlayManifestUrl"
                class="url-input"
                :placeholder="
                    $gettext(
                        'Overlay manifest URL (optional, defaults to base)',
                    )
                "
                @keyup.enter="onLoadOverlayManifest"
            />
            <Button
                :label="$gettext('Load')"
                severity="secondary"
                :loading="isLoading"
                @click="onLoadOverlayManifest"
            />
            <Select
                v-model="overlayCanvas"
                class="canvas-select"
                :options="overlayCanvasOptions"
                option-label="label"
                show-clear
                :placeholder="$gettext('Overlay canvas')"
            />
            <ToggleButton
                v-model="overlayVisible"
                :on-label="$gettext('Overlay on')"
                :off-label="$gettext('Overlay off')"
                :disabled="!overlayCanvas"
            />
            <div class="opacity-control">
                <span>{{ $gettext("Opacity") }} {{ opacityPercent }}%</span>
                <Slider
                    v-model="opacityPercent"
                    class="opacity-slider"
                    :disabled="!overlayCanvas"
                />
            </div>
        </div>

        <div class="controls-row">
            <Button
                v-for="button in commandButtons"
                :key="button.command"
                v-tooltip.bottom="button.label"
                :icon="button.icon"
                :aria-label="button.label"
                severity="secondary"
                @click="emit('command', button.command)"
            />
            <SelectButton
                v-model="drawingTool"
                :options="drawingToolOptions"
                option-label="label"
                option-value="value"
                :allow-empty="false"
            />
            <Button
                icon="pi pi-list"
                :label="$gettext('Log annotations')"
                severity="secondary"
                @click="emit('command', 'logAnnotations')"
            />
            <Button
                icon="pi pi-trash"
                :label="$gettext('Clear annotations')"
                severity="danger"
                outlined
                @click="emit('command', 'clearAnnotations')"
            />
        </div>

        <Message
            v-if="errorMessage"
            severity="error"
            :closable="true"
            @close="errorMessage = null"
        >
            {{ errorMessage }}
        </Message>
    </div>
</template>

<style scoped>
.comparison-controls {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.75rem;
    border-bottom: 0.0625rem solid var(--p-content-border-color);
    background: var(--p-content-background);
}

.controls-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
}

.url-input {
    flex: 1 1 24rem;
}

.canvas-select {
    width: 16rem;
}

.opacity-control {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    white-space: nowrap;
}

.opacity-slider {
    width: 10rem;
}
</style>
