import { ServiceUnavailableException } from '@nestjs/common';
import { NoopAiProvider } from './noop-ai.provider';

describe('NoopAiProvider', () => {
  const provider = new NoopAiProvider();

  it('reports itself as disabled', () => {
    expect(provider.enabled).toBe(false);
  });

  it('fails closed with 503 if analysis is requested', () => {
    expect(() => provider.analyzeSecurityEvents()).toThrow(
      ServiceUnavailableException,
    );
  });
});
