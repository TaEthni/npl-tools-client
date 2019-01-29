import { Component, OnInit, Input, OnChanges, Output, EventEmitter } from '@angular/core';
import { GNode, GMField, GMTemplate } from '../gen-mapper.interface';
import { GenMapperService, GenMapperConfig } from '../gen-mapper.service';
import { Unsubscribable } from '@core/Unsubscribable';
import { takeUntil, take } from 'rxjs/operators';
import { TemplateUtils } from '../template-utils';
import { LocaleService } from '@core/locale.service';
import { DocumentDto } from '@shared/entity/document.model';
import { MatDrawer, MatDialog } from '@angular/material';
import { cloneDeep, without, assign } from 'lodash';
import { FormGroup, FormControl } from '@angular/forms';
import { FileInputDialogComponent } from '@shared/file-input-dialog/file-input-dialog.component';
import { ConfirmDialogComponent } from '../dialogs/confirm-dialog/confirm-dialog.component';
import { NodeClipboardService } from '../node-clipboard.service';

@Component({
    selector: 'app-node-drawer',
    templateUrl: './node-drawer.component.html',
    styleUrls: ['./node-drawer.component.scss']
})
export class NodeDrawerComponent extends Unsubscribable implements OnInit, OnChanges {
    @Input()
    public node: GNode;

    @Input()
    public document: DocumentDto;

    @Input()
    public documents: DocumentDto[];

    @Input()
    public template: GMTemplate;

    @Output()
    public pasteNode = new EventEmitter<GNode>();

    @Output()
    public copyNode = new EventEmitter<GNode>();

    @Output()
    public updateNode = new EventEmitter<GNode>();

    @Output()
    public importSubtree = new EventEmitter<GNode>();

    public isNodeInClipboard: boolean;
    public clonedNode: GNode;
    public fields: GMField[];
    public form: FormGroup;

    constructor(
        private localeService: LocaleService,
        private genMapper: GenMapperService,
        private nodeClipboard: NodeClipboardService,
        private drawer: MatDrawer,
        private dialog: MatDialog,
    ) { super(); }

    public ngOnInit(): void {
        this.fields = this.template.fields;
        this.initializeForm();
        this.localeService.get()
            .pipe(takeUntil(this.unsubscribe))
            .subscribe(locale => {
                TemplateUtils.setTemplateLocale(this.template, locale);
                this.fields = this.template.fields;
            });

        this.nodeClipboard.get()
            .pipe(takeUntil(this.unsubscribe))
            .subscribe(result => {
                this.checkClipboard(result);
            });
    }

    public ngOnChanges(): void {
        if (this.node) {
            this.drawer.open();
            this.configureNode();
            console.log(this.node)
        } else {
            this.drawer.close();
        }
    }

    public configureNode(): void {
        this.checkClipboard();
        this.clonedNode = cloneDeep(this.node);
        delete this.clonedNode.descendants;
        this.form.reset(this.clonedNode);
    }

    public onBackdropClick(): void {
        this.drawer.disableClose = this.form.dirty;

        if (this.form.dirty && this.drawer.disableClose) {
            this.dialog
                .open(ConfirmDialogComponent, {
                    data: {
                        title: this.localeService.t('saveChanges'),
                        prompt: this.localeService.t('saveChangesQuestion'),
                        buttons: [
                            this.localeService.t('en_Yes'),
                            this.localeService.t('en_No')
                        ],
                    }
                })
                .afterClosed()
                .subscribe(result => {
                    if (result) {
                        this.onSave();
                    } else {
                        this.onCancel();
                        this.drawer.close();
                    }
                });
        } else {
            this.drawer.close();
        }
    }

    public onSave(): void {
        // if node is active, then remove reason for being inactive.
        if (this.clonedNode.hasOwnProperty('active') && this.clonedNode.hasOwnProperty('inactiveReason') && this.clonedNode.active) {
            this.clonedNode.inactiveReason = null;
        }

        assign(this.node, this.clonedNode);

        this.updateNode.emit(this.node);
        this.drawer.disableClose = false;
        this.genMapper.setNode(null);
    }

    public onPasteNode(): void {
        this.dialog
            .open(ConfirmDialogComponent, {
                data: {
                    title: this.localeService.t('messages.confirmPasteNode'),
                    alert: this.localeService.t('messages.confirmPasteNodeWarning'),
                }
            })
            .afterClosed()
            .subscribe(result => {
                if (result) {
                    this.pasteNode.emit(this.node);
                    this.drawer.close();
                }
            });
    }

    public onCopyNode(): void {
        this.copyNode.emit(this.node);
    }

    public onImportSubtree(): void {
        this.dialog
            .open(FileInputDialogComponent, { minWidth: '400px' })
            .afterClosed()
            .subscribe(result => {
                if (result) {
                    // Update graph
                    // this.graph.csvIntoNode(node, result.content);
                    this.importSubtree.emit(result.content);
                    this.drawer.close();
                }
            });
    }

    public onCancel(): void {
        this.configureNode();
        this.drawer.disableClose = this.form.dirty;
    }

    public onFormChange(value: GNode): void {
        assign(
            this.clonedNode,
            value
        );
        this.drawer.disableClose = this.form.dirty;
    }

    private initializeForm(): void {
        const group: any = {};

        this.fields
            .filter(field => !!field.type)
            .forEach(field => {
                group[field.header] = new FormControl(null);
            });

        // Add custom control for parentId
        group.parentId = new FormControl(null);

        this.form = new FormGroup(group);

        this.form.valueChanges
            .pipe(takeUntil(this.unsubscribe))
            .subscribe(() => {
                // we use getRawValue instead of form.value, so we can also get disabled controls
                this.onFormChange(this.form.getRawValue());
            });
    }

    private checkClipboard(clipboard?: GNode[]): void {
        clipboard = clipboard || this.nodeClipboard.getValue();
        if (!clipboard) {
            this.isNodeInClipboard = false;
        }

        if (clipboard) {
            const root = clipboard.find(n => n.parentId === '');
            if (root && root.id === this.node.id) {
                this.isNodeInClipboard = false;
            } else {
                this.isNodeInClipboard = true;
            }
        }
    }
}
