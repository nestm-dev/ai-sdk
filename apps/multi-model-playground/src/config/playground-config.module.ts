import { Global, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

import { validateEnvironment } from "./environment.ts";
import { PlaygroundConfigService } from "./playground-config.service.ts";

@Global()
@Module({
	imports: [
		ConfigModule.forRoot({
			isGlobal: true,
			cache: true,
			expandVariables: false,
			envFilePath: ".env.local",
			validate: validateEnvironment,
		}),
	],
	providers: [PlaygroundConfigService],
	exports: [PlaygroundConfigService],
})
export class PlaygroundConfigModule {}
