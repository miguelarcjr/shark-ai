import { describe, it, expect, beforeEach } from 'vitest';
import { AnchorStateManager } from './anchor-state-manager.js';
import fs from 'node:fs';
import path from 'node:path';

describe('AnchorStateManager', () => {
    let manager: AnchorStateManager;
    const testFile = path.resolve('test-anchor-file.txt');

    beforeEach(() => {
        manager = new AnchorStateManager();
        if (fs.existsSync(testFile)) {
            fs.unlinkSync(testFile);
        }
    });

    it('should prefix file lines with unique anchors on read', () => {
        fs.writeFileSync(testFile, 'line1\nline2\nline3');
        try {
            const anchored = manager.getAnchoredContent(testFile);
            const lines = anchored.split('\n');
            expect(lines).toHaveLength(3);
            
            // Check that they follow the format: <anchor>§<content>
            expect(lines[0]).toMatch(/^\w+§line1$/);
            expect(lines[1]).toMatch(/^\w+§line2$/);
            expect(lines[2]).toMatch(/^\w+§line3$/);

            // Anchors should be unique
            const anchor1 = lines[0].split('§')[0];
            const anchor2 = lines[1].split('§')[0];
            const anchor3 = lines[2].split('§')[0];
            expect(anchor1).not.toBe(anchor2);
            expect(anchor2).not.toBe(anchor3);
            expect(anchor1).not.toBe(anchor3);
        } finally {
            if (fs.existsSync(testFile)) {
                fs.unlinkSync(testFile);
            }
        }
    });

    it('should return cached anchored content on subsequent reads', () => {
        fs.writeFileSync(testFile, 'line1\nline2');
        try {
            const firstRead = manager.getAnchoredContent(testFile);
            const secondRead = manager.getAnchoredContent(testFile);
            expect(firstRead).toBe(secondRead);
        } finally {
            if (fs.existsSync(testFile)) {
                fs.unlinkSync(testFile);
            }
        }
    });

    it('should apply anchored edits and reconcile anchors', () => {
        fs.writeFileSync(testFile, 'line1\nline2\nline3\nline4');
        try {
            const firstRead = manager.getAnchoredContent(testFile);
            const linesBefore = firstRead.split('\n');
            const anchor1 = linesBefore[0].split('§')[0];
            const anchor2 = linesBefore[1].split('§')[0];
            const anchor3 = linesBefore[2].split('§')[0];
            const anchor4 = linesBefore[3].split('§')[0];

            // Replace line2 and line3 with new content
            manager.applyAnchoredEdit(testFile, anchor2, anchor3, 'new_lineA\nnew_lineB');

            // Verify content on disk
            const onDisk = fs.readFileSync(testFile, 'utf8');
            expect(onDisk).toBe('line1\nnew_lineA\nnew_lineB\nline4');

            // Verify the new anchored content
            const afterRead = manager.getAnchoredContent(testFile);
            const linesAfter = afterRead.split('\n');
            expect(linesAfter).toHaveLength(4);

            // Unchanged lines (line1, line4) should preserve their anchors
            expect(linesAfter[0]).toBe(`${anchor1}§line1`);
            expect(linesAfter[3]).toBe(`${anchor4}§line4`);

            // Added lines should get new unique anchors
            const newAnchorA = linesAfter[1].split('§')[0];
            const newAnchorB = linesAfter[2].split('§')[0];
            expect(linesAfter[1]).toBe(`${newAnchorA}§new_lineA`);
            expect(linesAfter[2]).toBe(`${newAnchorB}§new_lineB`);

            expect(newAnchorA).not.toBe(anchor1);
            expect(newAnchorA).not.toBe(anchor4);
            expect(newAnchorB).not.toBe(anchor1);
            expect(newAnchorB).not.toBe(anchor4);
            expect(newAnchorA).not.toBe(newAnchorB);
        } finally {
            if (fs.existsSync(testFile)) {
                fs.unlinkSync(testFile);
            }
        }
    });

    it('should not create duplicate anchors when inserting lines before existing ones and should preserve surrounding anchors', () => {
        fs.writeFileSync(testFile, 'line1\nline2\nline3\nline4');
        try {
            const firstRead = manager.getAnchoredContent(testFile);
            const linesBefore = firstRead.split('\n');
            const anchor1 = linesBefore[0].split('§')[0];
            const anchor2 = linesBefore[1].split('§')[0];
            const anchor3 = linesBefore[2].split('§')[0];
            const anchor4 = linesBefore[3].split('§')[0];

            // Insert a new line before line2 by editing anchor2 (line2) to (new_inserted\nline2)
            manager.applyAnchoredEdit(testFile, anchor2, anchor2, 'new_inserted\nline2');

            // Verify content on disk
            const onDisk = fs.readFileSync(testFile, 'utf8');
            expect(onDisk).toBe('line1\nnew_inserted\nline2\nline3\nline4');

            // Verify the new anchored content
            const afterRead = manager.getAnchoredContent(testFile);
            const linesAfter = afterRead.split('\n');
            expect(linesAfter).toHaveLength(5);

            // Anchors of unchanged lines before and after the insertion remain exactly unchanged
            const finalAnchors = linesAfter.map(l => l.split('§')[0]);
            const finalTexts = linesAfter.map(l => l.split('§')[1]);

            expect(finalTexts[0]).toBe('line1');
            expect(finalAnchors[0]).toBe(anchor1);

            expect(finalTexts[1]).toBe('new_inserted');
            const newAnchor = finalAnchors[1];

            expect(finalTexts[2]).toBe('line2');
            expect(finalAnchors[2]).toBe(anchor2);

            expect(finalTexts[3]).toBe('line3');
            expect(finalAnchors[3]).toBe(anchor3);

            expect(finalTexts[4]).toBe('line4');
            expect(finalAnchors[4]).toBe(anchor4);

            // There are no duplicate anchors in the updated file state
            const uniqueAnchors = new Set(finalAnchors);
            expect(uniqueAnchors.size).toBe(5);

            // Assert that the new anchor is indeed unique and not matching any existing one
            expect(newAnchor).not.toBe(anchor1);
            expect(newAnchor).not.toBe(anchor2);
            expect(newAnchor).not.toBe(anchor3);
            expect(newAnchor).not.toBe(anchor4);
        } finally {
            if (fs.existsSync(testFile)) {
                fs.unlinkSync(testFile);
            }
        }
    });

    it('should throw error if start or end anchor is not found', () => {
        fs.writeFileSync(testFile, 'line1\nline2');
        try {
            const anchored = manager.getAnchoredContent(testFile);
            const lines = anchored.split('\n');
            const anchor1 = lines[0].split('§')[0];

            expect(() => {
                manager.applyAnchoredEdit(testFile, 'nonexistent', anchor1, 'content');
            }).toThrow('Start anchor "nonexistent" not found');

            expect(() => {
                manager.applyAnchoredEdit(testFile, anchor1, 'nonexistent', 'content');
            }).toThrow('End anchor "nonexistent" not found');
        } finally {
            if (fs.existsSync(testFile)) {
                fs.unlinkSync(testFile);
            }
        }
    });
});
