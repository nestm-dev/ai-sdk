import type { CallHandler, ExecutionContext, NestInterceptor } from "@nestjs/common";
import { Injectable } from "@nestjs/common";
import type { Observable } from "rxjs";
import { mergeMap } from "rxjs";
import { isAiSdkHttpResponse } from "./ai-sdk-response.js";
import { AiSdkResponseSender } from "./ai-sdk-response.sender.js";

@Injectable()
export class AiSdkHttpInterceptor implements NestInterceptor {
	constructor(private readonly sender: AiSdkResponseSender) {}

	intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
		return next.handle().pipe(
			mergeMap(async (value: unknown) => {
				if (!isAiSdkHttpResponse(value)) {
					return value;
				}

				const http = context.switchToHttp();
				const response = await value.resolve();
				await this.sender.send(response, http.getResponse<unknown>(), http.getRequest<unknown>());
				return undefined;
			}),
		);
	}
}
