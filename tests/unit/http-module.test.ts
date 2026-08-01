import { APP_INTERCEPTOR } from "@nestjs/core";
import { MODULE_METADATA } from "@nestjs/common/constants";
import { describe, expect, it } from "vitest";
import {
	AiSdkHttpInterceptor,
	AiSdkHttpModule,
	AiSdkResponseSender,
} from "../../src/http/index.js";

describe("AiSdkHttpModule", () => {
	it("installs the interceptor and sender when imported directly", () => {
		const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, AiSdkHttpModule) as unknown[];

		expect(providers).toContain(AiSdkHttpInterceptor);
		expect(providers).toContain(AiSdkResponseSender);
		expect(providers).toContainEqual({
			provide: APP_INTERCEPTOR,
			useExisting: AiSdkHttpInterceptor,
		});
	});

	it("is module-local by default and supports explicit global registration", () => {
		expect(AiSdkHttpModule.register()).toMatchObject({
			module: AiSdkHttpModule,
			global: false,
		});
		expect(AiSdkHttpModule.register({ isGlobal: true })).toMatchObject({
			module: AiSdkHttpModule,
			global: true,
		});
	});
});
