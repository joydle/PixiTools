/**
 * Message Contract Tests
 *
 * Verifies that all message types conform to the expected contract.
 */

import { describe, it, expect } from 'vitest';
import type {
  ObjectSelectedMessage,
  ObjectDeselectedMessage,
  GamePausedMessage,
  GameResumedMessage,
  InspectorReadyMessage,
  SceneTreeMessage,
  ObjectMetadata,
  EngineType,
} from '../../src/inspector/core/types';

describe('Message Contract', () => {
  const engines: EngineType[] = ['pixi', 'phaser', 'kaboom', 'threejs'];

  describe('OBJECT_SELECTED message', () => {
    it('should have required fields for 2D engines', () => {
      const message: ObjectSelectedMessage = {
        type: 'OBJECT_SELECTED',
        engine: 'pixi',
        metadata: {
          type: 'player_sprite',
          typeName: 'Sprite',
          layer: 500,
          position: { x: 100, y: 200 },
          rotation: { rotation: 0.5 },
          scale: { x: 1, y: 1 },
          alpha: 1.0,
          visible: true,
          childCount: 0,
          bounds: { x: 50, y: 150, width: 100, height: 100 },
          parentLabel: 'Stage',
          sourceFile: 'main.ts',
          sourceLine: 45,
          sourceLineRange: { startLine: 40, endLine: 50 },
        },
        clickX: 150,
        clickY: 250,
      };

      expect(message.type).toBe('OBJECT_SELECTED');
      expect(message.engine).toBe('pixi');
      expect(message.metadata.type).toBeDefined();
      expect(message.metadata.position).toBeDefined();
      expect(message.clickX).toBeDefined();
      expect(message.clickY).toBeDefined();
    });

    it('should have required fields for 3D engines', () => {
      const message: ObjectSelectedMessage = {
        type: 'OBJECT_SELECTED',
        engine: 'threejs',
        metadata: {
          type: 'player_ship',
          typeName: 'Mesh',
          layer: 500,
          position: { x: 0, y: 5, z: -10 },
          rotation: { x: 0, y: 1.57, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          alpha: 1.0,
          visible: true,
          childCount: 3,
          bounds: { x: 200, y: 150, width: 100, height: 80 },
          parentLabel: 'Scene',
          sourceFile: 'game.ts',
          sourceLine: 120,
          sourceLineRange: { startLine: 115, endLine: 125 },
        },
        clickX: 320,
        clickY: 240,
      };

      const pos = message.metadata.position as { x: number; y: number; z: number };
      expect(pos.z).toBeDefined();

      const rot = message.metadata.rotation as { x: number; y: number; z: number };
      expect(rot.x).toBeDefined();
      expect(rot.y).toBeDefined();
      expect(rot.z).toBeDefined();
    });

    it('should allow null source tracking', () => {
      const metadata: ObjectMetadata = {
        type: 'unknown_object',
        typeName: 'Object',
        layer: 100,
        position: { x: 0, y: 0 },
        scale: { x: 1, y: 1 },
        alpha: 1,
        visible: true,
        childCount: 0,
        bounds: { x: 0, y: 0, width: 50, height: 50 },
        parentLabel: 'Scene',
        sourceFile: null,
        sourceLine: null,
        sourceLineRange: null,
      };

      expect(metadata.sourceFile).toBeNull();
      expect(metadata.sourceLine).toBeNull();
      expect(metadata.sourceLineRange).toBeNull();
    });
  });

  describe('OBJECT_DESELECTED message', () => {
    it('should have minimal required fields', () => {
      engines.forEach(engine => {
        const message: ObjectDeselectedMessage = {
          type: 'OBJECT_DESELECTED',
          engine,
        };

        expect(message.type).toBe('OBJECT_DESELECTED');
        expect(message.engine).toBe(engine);
      });
    });
  });

  describe('GAME_PAUSED message', () => {
    it('should have minimal required fields', () => {
      engines.forEach(engine => {
        const message: GamePausedMessage = {
          type: 'GAME_PAUSED',
          engine,
        };

        expect(message.type).toBe('GAME_PAUSED');
        expect(message.engine).toBe(engine);
      });
    });
  });

  describe('GAME_RESUMED message', () => {
    it('should have minimal required fields', () => {
      engines.forEach(engine => {
        const message: GameResumedMessage = {
          type: 'GAME_RESUMED',
          engine,
        };

        expect(message.type).toBe('GAME_RESUMED');
        expect(message.engine).toBe(engine);
      });
    });
  });

  describe('INSPECTOR_READY message', () => {
    it('should have minimal required fields', () => {
      engines.forEach(engine => {
        const message: InspectorReadyMessage = {
          type: 'INSPECTOR_READY',
          engine,
        };

        expect(message.type).toBe('INSPECTOR_READY');
        expect(message.engine).toBe(engine);
      });
    });
  });

  describe('SCENE_TREE message', () => {
    it('should have tree structure', () => {
      const message: SceneTreeMessage = {
        type: 'SCENE_TREE',
        engine: 'threejs',
        tree: {
          name: 'Scene',
          type: 'Scene',
          children: [
            {
              name: 'player',
              type: 'Mesh',
              children: [],
            },
            {
              name: 'enemies',
              type: 'Group',
              children: [
                { name: 'enemy1', type: 'Mesh', children: [] },
                { name: 'enemy2', type: 'Mesh', children: [] },
              ],
            },
          ],
        },
      };

      expect(message.tree.name).toBe('Scene');
      expect(message.tree.children).toHaveLength(2);
      expect(message.tree.children[1].children).toHaveLength(2);
    });
  });

  describe('Layer values', () => {
    it('should have correct layer priority order', () => {
      // UI > Interactive > Object > Background
      const UI = 1000;
      const Interactive = 500;
      const GameObj = 100;
      const Background = 0;

      expect(UI).toBeGreaterThan(Interactive);
      expect(Interactive).toBeGreaterThan(GameObj);
      expect(GameObj).toBeGreaterThan(Background);
    });
  });
});
