/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import fs from "fs";
import path from "path";
import { format } from "./build/lib/formatter.ts";

const REPO_ROOT = "d:/Projects/code/vscode";

function formatFile(filePath: string) {
	const fullPath = path.resolve(REPO_ROOT, filePath);
	console.log(`Formatting ${fullPath}`);
	if (!fs.existsSync(fullPath)) {
		console.warn(`File NOT found: ${fullPath}`);
		return;
	}
	const content = fs.readFileSync(fullPath, "utf8");
	const formatted = format(fullPath, content);

	if (content !== formatted) {
		console.log(`Fixed formatting for ${filePath}`);
		fs.writeFileSync(fullPath, formatted);
	} else {
		console.log(`No formatting changes needed for ${filePath}`);
	}
}

const files = [
	"src/vs/workbench/contrib/chat/browser/agentSessions/agentSessionsPicker.ts",
	"src/vs/workbench/contrib/chat/browser/agentSessions/agentSessionsViewer.ts",
	"src/vs/workbench/contrib/chat/browser/agentSessions/agentSessions.ts",
	"src/vs/workbench/contrib/chat/browser/agentSessions/agentSessionsActions.ts",
	"src/vs/workbench/contrib/chat/browser/actions/chatActions.ts",
	"src/vs/workbench/contrib/chat/browser/actions/chatNewActions.ts",
];

files.forEach(formatFile);
