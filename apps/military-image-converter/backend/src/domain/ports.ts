import type { GenerateRequest, GeneratedCode, RefineRequest } from './entities';

export interface CodeGeneratorPort {
  generate(req: GenerateRequest): Promise<GeneratedCode>;
  refine(req: RefineRequest): Promise<GeneratedCode>;
}
