/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
import { CancellationToken } from "vscode";

import { timeoutPromise } from "../../common/cancellation";
import Dap from "../../dap/api";

export async function launchUnelevatedChrome(
	dap: Dap.Api,
	chromePath: string,
	chromeArgs: string[],
	cancellationToken: CancellationToken,
): Promise<void> {
	const response = dap.launchUnelevatedRequest({
		process: chromePath,
		args: chromeArgs,
	});

	await timeoutPromise(
		response,
		cancellationToken,
		"Could not launch browser unelevated",
	);
}
