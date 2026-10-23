import { App, Modal, Notice, Setting } from "obsidian";
import { migrationPreviewMarkdown, type MigrationPlan, type MigrationJournal } from "./library-migration";
import { LibraryMaintenance } from "./library-maintenance";

export class MigrationPreviewModal extends Modal {
  constructor(app: App, private maintenance: LibraryMaintenance, private plan: MigrationPlan, private reportPath: string) { super(app); }
  onOpen(): void {
    this.titleEl.setText("TSNotes · 视频库迁移预览");
    this.contentEl.createEl("p", { text: "尚未移动文件。确认后将按下列清单备份、整理并核对。TSNotes 目录外的笔记保持原位；可能更新的引用也已列入备份范围。" });
    this.contentEl.createEl("p", { text: `预览文件：${this.reportPath}` });
    const preview = this.contentEl.createEl("pre", { text: migrationPreviewMarkdown(this.plan) });
    preview.style.cssText = "max-height:48vh;overflow:auto;white-space:pre-wrap;font-size:12px";
    new Setting(this.contentEl)
      .addButton(button => button.setButtonText("取消").onClick(() => this.close()))
      .addButton(button => button.setButtonText("确认清单并开始整理").setCta().setDisabled(this.plan.errors.length > 0).onClick(async () => {
        button.setDisabled(true).setButtonText("正在整理…");
        try { await this.maintenance.apply(this.plan, this.plan.digest); new Notice("TSNotes 视频库整理完成，恢复记录已保留。"); this.close(); }
        catch (error) { new Notice("TSNotes: " + (error instanceof Error ? error.message : String(error)), 10000); button.setButtonText("已停止，请检查后重新预览"); }
      }));
  }
}

export class MigrationRecoveryModal extends Modal {
  constructor(app: App, private maintenance: LibraryMaintenance, private journal: MigrationJournal, private mode: "resume" | "rollback") { super(app); }
  onOpen(): void {
    this.titleEl.setText(this.mode === "resume" ? "TSNotes · 恢复视频库整理" : "TSNotes · 回滚视频库整理");
    this.contentEl.createEl("p", { text: `记录 ${this.journal.id} · 阶段 ${this.journal.phase} · 已处理 ${this.journal.step}/${this.journal.plan.items.length}` });
    this.contentEl.createEl("p", { text: "先核对所有文件校验值。整理后产生的新修改、目标占用或新的外部引用会阻止自动恢复，不会覆盖用户的新内容。" });
    if (this.journal.pending) this.contentEl.createEl("p", { text: `上一步未完成确认：${this.journal.pending}。需要人工检查备份和现场，当前禁止自动继续。` });
    const preview = this.contentEl.createEl("pre", { text: migrationPreviewMarkdown(this.journal.plan) });
    preview.style.cssText = "max-height:45vh;overflow:auto;white-space:pre-wrap;font-size:12px";
    new Setting(this.contentEl).addButton(b => b.setButtonText("取消").onClick(() => this.close()))
      .addButton(b => b.setButtonText(this.mode === "resume" ? "继续已确认的整理" : "核对并回滚").setDisabled(!!this.journal.pending).onClick(async () => {
        b.setDisabled(true);
        try { await this.maintenance[this.mode](this.journal); new Notice("TSNotes: " + (this.mode === "resume" ? "整理已完成" : "已回滚")); this.close(); }
        catch (error) { new Notice("TSNotes: " + (error instanceof Error ? error.message : String(error)), 10000); }
      }));
  }
}

export async function showViewReview(app: App, maintenance: LibraryMaintenance): Promise<void> {
  const changes = await maintenance.viewPreview(), selected = new Set(changes.filter(c => c.beforeHash === null).map(c => c.path));
  class ViewReview extends Modal {
    onOpen(): void {
      this.titleEl.setText("TSNotes · 更新库视图预览");
      this.contentEl.createEl("p", { text: "缺失视图默认选中；已有视图默认不选。选择已有视图代表确认用当前模板替换其列、排序和筛选。执行前备份并重新核对校验值。" });
      for (const change of changes) new Setting(this.contentEl).setName(change.path).setDesc(change.beforeHash === null ? "缺失，将创建" : change.changed ? "与当前模板不同，默认保留" : "已与模板一致，无需更新")
        .addToggle(t => t.setValue(selected.has(change.path)).setDisabled(!change.changed).onChange(value => { if (value) selected.add(change.path); else selected.delete(change.path); }));
      new Setting(this.contentEl).addButton(b => b.setButtonText("取消").onClick(() => this.close()))
        .addButton(b => b.setButtonText("应用已选择的变更").onClick(async () => {
          const approved = changes.filter(c => selected.has(c.path)); if (!approved.length) { new Notice("未选择变更"); return; }
          b.setDisabled(true);
          try { await maintenance.applyViews(approved); new Notice("库视图已更新，备份已保留。"); this.close(); }
          catch (error) { new Notice("TSNotes: " + (error instanceof Error ? error.message : String(error))); }
        }));
    }
  }
  new ViewReview(app).open();
}
