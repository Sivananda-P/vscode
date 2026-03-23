/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import * as path from 'path';

export interface ISkill {
	name: string;
	description: string;
	content: string;
}

export class SkillService {
	private static skills: Map<string, ISkill> = new Map();
	private static skillsPath = path.join(process.cwd(), '..', 'extensions', 'cogniai-skills', 'skills');

	static async loadSkills(): Promise<void> {
		try {
			const skillDirs = await fs.readdir(this.skillsPath);
			for (const dir of skillDirs) {
				const skillFile = path.join(this.skillsPath, dir, 'SKILL.md');
				try {
					const content = await fs.readFile(skillFile, 'utf8');
					// Simplistic frontmatter parsing
					const nameMatch = content.match(/name:\s*(.*)/);
					const descMatch = content.match(/description:\s*(.*)/);
					
					if (nameMatch) {
						const name = nameMatch[1].trim();
						this.skills.set(name.toLowerCase(), {
							name,
							description: descMatch ? descMatch[1].trim() : '',
							content: content
						});
					}
				} catch (err) {
					console.error(`Error loading skill from ${skillFile}:`, err);
				}
			}
			console.log(`[SkillService] Loaded ${this.skills.size} skills.`);
		} catch (err) {
			console.error(`[SkillService] Failed to read skills directory: ${this.skillsPath}`, err);
		}
	}

	static getSkill(name: string): ISkill | undefined {
		return this.skills.get(name.toLowerCase());
	}

	static getSkills(): ISkill[] {
		return Array.from(this.skills.values());
	}

	static async getSystemPrompt(skillName?: string): Promise<string> {
		if (!skillName) {
			return '';
		}
		
		const skill = this.getSkill(skillName);
		if (!skill) {
			return '';
		}

		return `\n\n--- SKILL ACTIVE: ${skill.name} ---\n${skill.content}\n--- END SKILL ---\n`;
	}
}
