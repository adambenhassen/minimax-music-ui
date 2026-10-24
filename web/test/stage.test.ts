import { describe, expect, it } from 'vitest';
import { parseStage, phasesFor, phaseIndex } from '../src/lib/stage';

describe('parseStage', () => {
  it.each(['semantic', 'denoise', 'download', 'mystery', ''])('keeps queued tracks queued regardless of stage (%s)', (stage) => {
    expect(parseStage(stage, 'queued', null)).toMatchObject({ phase: 'queued', real: false });
  });

  it('normalizes a semantic stage while running', () => {
    expect(parseStage(' SEMANTIC ', 'running', null)).toMatchObject({ phase: 'semantic', real: true });
  });

  it.each([null, 0])('labels a denoise stage without rendered audio (%s seconds)', (renderedSeconds) => {
    expect(parseStage('denoise', 'running', renderedSeconds)).toEqual({
      phase: 'denoise',
      label: 'Rendering audio',
      real: true,
    });
  });

  it('labels a denoise stage with rendered audio', () => {
    expect(parseStage('denoise', 'running', 1)).toEqual({
      phase: 'denoise',
      label: 'Rendering — you can listen now',
      real: true,
    });
  });

  it('classifies any stage containing download as a download phase', () => {
    expect(parseStage('upstream download complete', 'running', null)).toMatchObject({
      phase: 'download',
      real: false,
    });
  });

  it.each(['mystery', ''])('estimates denoise for an unknown stage (%s)', (stage) => {
    expect(parseStage(stage, 'running', null)).toMatchObject({ phase: 'denoise', real: false });
  });
});

describe('phasesFor', () => {
  it('omits semantic from estimated renders', () => {
    expect(phasesFor(false).map(({ id }) => id)).toEqual(['queued', 'denoise', 'download']);
  });

  it('returns -1 for a phase omitted from an estimated render', () => {
    expect(phaseIndex(phasesFor(false), 'semantic')).toBe(-1);
  });
});
