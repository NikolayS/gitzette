export const TEXT_MODEL = "openai/gpt-6-astra" as const;
export const IMAGE_MODEL = "openai/gpt-image-2.5-sunburst" as const;
export const TEXT_MODEL_ID = TEXT_MODEL.slice("openai/".length);
export const IMAGE_MODEL_ID = IMAGE_MODEL.slice("openai/".length);
