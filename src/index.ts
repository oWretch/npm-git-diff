import * as os from "node:os";
import { execFileSync } from "node:child_process";

const git = os.platform().startsWith("win") ? "git.exe" : "git";

/**
 * Get the local filesystem changes using the git diff command
 * @param files optional list of files to get changes for
 * @param contextLines number of lines of context to include in the generated diff
 * @returns a set of changes
 */
export function getChanges(
	files: Set<string> = new Set<string>(),
	contextLines = 0,
): Set<Change> {
	console.info("Identifying local changes");

	// Stage the changes before generating the diff
	// This helps to match any renamed files, as a diff
	// on the unstaged files doesn't match for renames
	console.info("Staging all changes");
	try {
		execFileSync(git, ["add", "--all"]);
	} catch (error) {
		console.error(`Error staging changes: ${error}`);
		throw error;
	}

	console.info("Creating a unified diff");
	let args = [
		"diff",
		"--minimal", // Create the smallest diff possible
		"--no-color", // No color codes
		`--unified=${contextLines}`, // Number of lines of context to include
		"HEAD", // To get all changes, staged and unstaged
	];
	if (files.size > 0) {
		args = args.concat(["--", ...files]);
	}
	console.debug(`args: ${args}`);

	let diffOut: string;
	try {
		const stdout = execFileSync(git, args);
		diffOut = stdout.toString();
		console.debug(`diff output:\n${diffOut}`);
	} catch (error) {
		console.error(`Error running git diff: ${error}`);
		throw error;
	}

	if (!diffOut) {
		console.log("No changes found");
		return new Set<Change>();
	}

	const changes = new Set<Change>();
	const changedFiles = diffOut.split("diff --git").filter((n) => n);
	console.log(`Found ${changedFiles.length} files with changes`);

	for (const fileDiff of changedFiles) {
		// Split the output lines into an array
		const lines = fileDiff.split("\n").filter((n) => n);

		let isAddedFile = false;
		let isDeletedFile = false;

		// Skip any header lines
		while (!lines[0].startsWith("---")) {
			lines.shift();
		}

		// Get the file names
		// Diff pattern:
		// --- a/path/oldfile.name
		// +++ b/path/newfile.name
		const fromFileName = lines.shift()?.replace("--- a/", "");
		const toFileName = lines.shift()?.replace("+++ b/", "");
		if (fromFileName === undefined || toFileName === undefined) {
			console.error("Error parsing file names");
			continue;
		}
		if (fromFileName === "/dev/null") {
			console.log(`File ${toFileName} added`);
			isAddedFile = true;
		} else if (toFileName === "/dev/null") {
			console.log(`File ${fromFileName} deleted`);
			isDeletedFile = true;
		} else if (fromFileName !== toFileName)
			console.log(`File renamed from ${fromFileName} to ${toFileName}`);
		else {
			console.log(`Finding changes in ${fromFileName}`);
		}

		// Split the file diff into the chunks
		// This produces an array of chunks, where
		// i0 = location information
		// i1 = changed information
		const diffChunks = lines
			.join("\n")
			.split(/@@ (-\d+(?:,\d+)? \+\d+(?:,\d+)?) @@/)
			.filter((n) => n);

		for (let i = 0; i < diffChunks.length; i += 2) {
			// Get the file position for this chunk
			// File position pattern:
			// -fromStart[,fromCount] +toStart[,toCount]
			const locationRegExp = /-(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))?/;
			const locationMatch = diffChunks[0].match(locationRegExp);
			if (locationMatch === null) {
				console.error("Error parsing location information");
				continue;
			}

			let fromFile: FileChange | undefined;
			let toFile: FileChange | undefined;
			if (!isAddedFile) {
				fromFile = {
					name: fromFileName,
					start_line: Number(locationMatch[1]),
					line_count: Number(locationMatch[2]) || 1,
					content: "",
				};
			}
			if (!isDeletedFile) {
				toFile = {
					name: toFileName,
					start_line: Number(locationMatch[3]),
					line_count: Number(locationMatch[4]) || 1,
					content: "",
				};
			}

			// Get the details of the change
			const changedLines = diffChunks[i + 1].split("\n");
			while (changedLines.length > 0) {
				const line = changedLines.shift();
				if (line === undefined) {
					break;
				}
				if (line.startsWith("-")) {
					// Line is removed in the new file
					if (fromFile === undefined) {
						console.error("Error: fromFile is undefined");
						continue;
					}
					fromFile.content += `${line.replace(/- ?/, "")}\n`;
				} else if (line.startsWith("+")) {
					// Line is added in the new file
					if (toFile === undefined) {
						console.error("Error: toFile is undefined");
						continue;
					}
					toFile.content += `${line.replace(/\+ ?/, "")}\n`;
				} else {
					// Line is unchanged
					if (fromFile === undefined) {
						console.error("Error: fromFile is undefined");
						continue;
					}
					if (toFile === undefined) {
						console.error("Error: toFile is undefined");
						continue;
					}
					fromFile.content += `${line.replace(/ ? ?/, "")}\n`;
					toFile.content += `${line.replace(/ ? ?/, "")}\n`;
				}
			}

			changes.add(<Change>{
				fromFile: fromFile,
				toFile: toFile,
			});
		}
	}
	return changes;
}
