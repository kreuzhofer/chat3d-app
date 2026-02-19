import { IRenderingProvider } from "./IRenderingProvider";
import { RenderingProvider } from "./LLMDefinitions";
import { OpenScadRenderingProvider } from "./OpenScadRenderingProvider";
import { Build123dRenderingProvider } from "./Build123dRenderingProvider";

export class RenderingProviderFactory {
    static initializeProvider(provider: RenderingProvider, executorFunctionName?: string): IRenderingProvider {
        switch (provider) {
            case RenderingProvider.OpenScad:
                if (!executorFunctionName) {
                    throw new Error('executorFunctionName is required for OpenScad rendering provider');
                }
                return new OpenScadRenderingProvider(executorFunctionName);
            case RenderingProvider.Build123d:
                return new Build123dRenderingProvider();
            default:
                throw new Error(`Unsupported Execution Provider: ${provider}`);
        }
    }
}