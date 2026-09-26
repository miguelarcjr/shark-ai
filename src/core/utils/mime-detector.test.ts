import { describe, it, expect } from 'vitest';
import { detectMimeType, isMediaVideo, isMediaImage, isMediaAudio } from './mime-detector.js';

describe('mime-detector', () => {
    it('detects video mime types correctly including case-insensitivity', () => {
        expect(detectMimeType('video.webm')).toBe('video/webm');
        expect(detectMimeType('/path/to/capture.WEBM')).toBe('video/webm');
        expect(detectMimeType('D:\\recordings\\run-123.mp4')).toBe('video/mp4');
        expect(detectMimeType('sample.mkv')).toBe('video/x-matroska');
        expect(detectMimeType('sample.mov')).toBe('video/quicktime');
    });

    it('detects image mime types correctly', () => {
        expect(detectMimeType('screenshot.png')).toBe('image/png');
        expect(detectMimeType('photo.JPG')).toBe('image/jpeg');
        expect(detectMimeType('photo.jpeg')).toBe('image/jpeg');
        expect(detectMimeType('banner.webp')).toBe('image/webp');
        expect(detectMimeType('icon.svg')).toBe('image/svg+xml');
    });

    it('detects audio and document mime types correctly', () => {
        expect(detectMimeType('audio.mp3')).toBe('audio/mpeg');
        expect(detectMimeType('voice.ogg')).toBe('audio/ogg');
        expect(detectMimeType('report.pdf')).toBe('application/pdf');
        expect(detectMimeType('data.json')).toBe('application/json');
        expect(detectMimeType('notes.md')).toBe('text/markdown');
        expect(detectMimeType('archive.zip')).toBe('application/zip');
    });

    it('falls back to application/octet-stream for unknown extensions or files without extension', () => {
        expect(detectMimeType('unknown.xyz')).toBe('application/octet-stream');
        expect(detectMimeType('LICENSE')).toBe('application/octet-stream');
    });

    it('identifies media categories with helper functions', () => {
        expect(isMediaVideo('video/webm')).toBe(true);
        expect(isMediaVideo('image/png')).toBe(false);
        expect(isMediaImage('image/png')).toBe(true);
        expect(isMediaImage('video/mp4')).toBe(false);
        expect(isMediaAudio('audio/ogg')).toBe(true);
        expect(isMediaAudio('application/pdf')).toBe(false);
    });
});
