export const IMAGE_RESOLUTION_OPTIONS = ['1K', '2K', '4K'] as const;

export const IMAGE_ASPECT_RATIO_OPTIONS = [
    '1:1',
    '1:4',
    '1:8',
    '2:3',
    '3:2',
    '3:4',
    '4:1',
    '4:3',
    '4:5',
    '5:4',
    '8:1',
    '9:16',
    '16:9',
    '21:9'
] as const;

export type ImageAspectRatioOption = typeof IMAGE_ASPECT_RATIO_OPTIONS[number];
