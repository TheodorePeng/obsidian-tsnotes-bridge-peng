import {App, Modal, Notice, Setting} from "obsidian";
import type {LibraryUpgrade, UpgradePreview} from "./library-upgrade";

export class LibraryUpgradeModal extends Modal {
  constructor(app: App, private upgrade: LibraryUpgrade, private plan: UpgradePreview, private report: string) {super(app);}
  onOpen(): void {this.render();}
  private render(): void {
    this.titleEl.setText("TSNotes Library 与属性迁移预览"); this.contentEl.empty();
    this.contentEl.createEl("p", {text: `移动 ${this.plan.files.length} 个文件；精简 ${this.plan.files.filter(f => f.properties?.length).length} 篇记录的属性。`});
    this.contentEl.createEl("p", {text: `完整清单与属性原值：${this.report}`});
    this.contentEl.createEl("pre", {text: this.plan.folders.map(f => f.from + " → " + f.to).join("\n")});
    this.contentEl.createEl("p", {text: "默认不修改 QA Retained。下面每项授权只允许更新列出的笔记内链，不移动或清理该目录。"});
    for (const path of this.plan.protectedReferences) new Setting(this.contentEl).setName(path).setDesc("明确允许原生文件移动更新此笔记的引用")
      .addToggle(toggle => toggle.setValue(this.plan.allowedProtected.includes(path)).onChange(async value => {
        const allowed = new Set(this.plan.allowedProtected); if (value) allowed.add(path); else allowed.delete(path);
        this.plan = await this.upgrade.preview([...allowed]); this.report = await this.upgrade.exportPreview(this.plan); this.render();
      }));
    this.contentEl.createEl("pre", {text: this.plan.issues.length ? this.plan.issues.join("\n") : "无阻塞项"});
    this.contentEl.createEl("p", {text: "确认摘要：" + this.plan.digest});
    new Setting(this.contentEl).addButton(button => button.setButtonText("确认清单并迁移").setCta().setDisabled(!!this.plan.issues.length || !this.plan.folders.length).onClick(async () => {
      button.setDisabled(true);
      try {const result = await this.upgrade.apply(this.plan, this.plan.digest); new Notice("Library 迁移完成，备份：" + this.upgrade.local + "/" + result.id, 12000); this.close();}
      catch (error) {new Notice("迁移已停止：" + (error instanceof Error ? error.message : String(error)), 12000);}
    }));
  }
}
