import type { CanvasInfo, ManifestInfo } from "@/iiifrecon/iiif/types.ts";

// Manifests are untyped JSON from arbitrary servers, so they are walked loosely.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

function asArray(value: Json): Json[] {
    if (value === undefined || value === null) {
        return [];
    }
    return Array.isArray(value) ? value : [value];
}

function getId(resource: Json): string {
    return resource?.id ?? resource?.["@id"] ?? "";
}

// v3 labels are language maps; v2 labels are strings, arrays, or {@value}s.
function getLabel(label: Json, fallback: string): string {
    if (!label) {
        return fallback;
    }
    if (typeof label === "string") {
        return label;
    }
    if (Array.isArray(label)) {
        return getLabel(label[0], fallback);
    }
    if (label["@value"]) {
        return label["@value"];
    }
    const values = Object.values(label)[0];
    return asArray(values)[0] ?? fallback;
}

function getImageApiVersion(service: Json): 2 | 3 | undefined {
    const type = service?.type ?? service?.["@type"] ?? "";
    const context = asArray(service?.["@context"]).join(" ");
    const profile = asArray(service?.profile).join(" ");
    if (type === "ImageService3" || context.includes("/image/3/")) {
        return 3;
    }
    if (
        type === "ImageService2" ||
        context.includes("/image/2/") ||
        profile.includes("/image/2/")
    ) {
        return 2;
    }
    return undefined;
}

function findImageService(body: Json): Json | undefined {
    return asArray(body?.service).find((service) => {
        const type = service?.type ?? service?.["@type"] ?? "";
        return (
            type.startsWith("ImageService") ||
            getImageApiVersion(service) !== undefined
        );
    });
}

function buildCanvasInfo(
    canvas: Json,
    body: Json,
    manifestId: string,
    index: number,
): CanvasInfo | null {
    // A Choice body offers alternative images; the first is the default.
    if (body?.type === "Choice" || body?.["@type"] === "oa:Choice") {
        body = asArray(body.items ?? body.default)[0];
    }
    if (!body) {
        return null;
    }
    const service = findImageService(body);
    const imageServiceUrl = service
        ? getId(service).replace(/\/(info\.json)?$/, "")
        : undefined;

    return {
        id: getId(canvas),
        label: getLabel(canvas.label, `Canvas ${index + 1}`),
        width: canvas.width ?? body.width,
        height: canvas.height ?? body.height,
        manifestId,
        imageUrl: getId(body),
        imageServiceUrl,
        imageApiVersion: service ? getImageApiVersion(service) : undefined,
    };
}

function parseV3Canvases(manifest: Json, manifestId: string): CanvasInfo[] {
    return asArray(manifest.items)
        .filter((item) => item.type === "Canvas")
        .map((canvas, index) => {
            const paintingAnnotation = asArray(canvas.items)
                .flatMap((page) => asArray(page.items))
                .find((annotation) => annotation.motivation === "painting");
            return buildCanvasInfo(
                canvas,
                paintingAnnotation?.body,
                manifestId,
                index,
            );
        })
        .filter((canvas): canvas is CanvasInfo => canvas !== null);
}

function parseV2Canvases(manifest: Json, manifestId: string): CanvasInfo[] {
    return asArray(manifest.sequences?.[0]?.canvases)
        .map((canvas, index) =>
            buildCanvasInfo(
                canvas,
                asArray(canvas.images)[0]?.resource,
                manifestId,
                index,
            ),
        )
        .filter((canvas): canvas is CanvasInfo => canvas !== null);
}

export async function loadManifest(url: string): Promise<ManifestInfo> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch manifest (${response.status})`);
    }
    const manifest = await response.json();
    const id = getId(manifest) || url;
    const canvases = manifest.sequences
        ? parseV2Canvases(manifest, id)
        : parseV3Canvases(manifest, id);

    if (!canvases.length) {
        throw new Error("Manifest does not contain any image canvases");
    }

    return { id, label: getLabel(manifest.label, url), canvases };
}

export function getInfoJsonUrl(canvas: CanvasInfo): string | undefined {
    return canvas.imageServiceUrl
        ? `${canvas.imageServiceUrl}/info.json`
        : undefined;
}

export async function fetchImageInfo(canvas: CanvasInfo): Promise<Json> {
    const response = await fetch(getInfoJsonUrl(canvas)!);
    if (!response.ok) {
        throw new Error(`Failed to fetch image info (${response.status})`);
    }
    return response.json();
}
