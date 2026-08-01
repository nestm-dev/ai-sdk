import type { DynamicModule, Provider } from "@nestjs/common";
import { Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { AiSdkHttpInterceptor } from "./ai-sdk-http.interceptor.js";
import { AiSdkResponseSender } from "./ai-sdk-response.sender.js";

export interface AiSdkHttpModuleOptions {
	/** Make the module's exported providers globally injectable. Defaults to false. */
	readonly isGlobal?: boolean;
}

const HTTP_PROVIDERS: Provider[] = [
	AiSdkResponseSender,
	AiSdkHttpInterceptor,
	{
		provide: APP_INTERCEPTOR,
		useExisting: AiSdkHttpInterceptor,
	},
];

@Module({
	providers: HTTP_PROVIDERS,
	exports: [AiSdkResponseSender, AiSdkHttpInterceptor],
})
export class AiSdkHttpModule {
	static register(options: AiSdkHttpModuleOptions = {}): DynamicModule {
		return {
			module: AiSdkHttpModule,
			global: options.isGlobal ?? false,
		};
	}
}
