import type { CodeGeneratorPort }            from '../domain/ports';
import type { GenerateRequest, GeneratedCode } from '../domain/entities';

export class GenerateCodeUseCase {
  constructor(private readonly generator: CodeGeneratorPort) {}
  execute(req: GenerateRequest): Promise<GeneratedCode> {
    return this.generator.generate(req);
  }
}
