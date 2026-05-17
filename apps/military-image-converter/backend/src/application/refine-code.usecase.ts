import type { CodeGeneratorPort }           from '../domain/ports';
import type { RefineRequest, GeneratedCode } from '../domain/entities';

export class RefineCodeUseCase {
  constructor(private readonly generator: CodeGeneratorPort) {}
  execute(req: RefineRequest): Promise<GeneratedCode> {
    return this.generator.refine(req);
  }
}
