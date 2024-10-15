interface Change {
	fromFile?: FileChange;
	toFile?: FileChange;
}

interface FileChange {
	name: string;
	start_line: number;
	line_count: number;
	content: string;
}
