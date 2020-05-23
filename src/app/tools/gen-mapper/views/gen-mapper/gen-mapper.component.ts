import { Component, HostBinding, OnInit, Optional, ViewChild } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarRef } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { AuthenticationService } from '@core/authentication.service';
import { CSVToJSON } from '@core/csv-to-json';
import { LocaleService } from '@core/locale.service';
import { TemplateUtils } from '@core/template-utils';
import { Unsubscribable } from '@core/Unsubscribable';
import { DocumentDto } from '@models/document.model';
import { NodeDto } from '@models/node.model';
import { Template } from '@models/template.model';
import { FileInputDialogComponent } from '@shared/file-input-dialog/file-input-dialog.component';
import { some } from 'lodash';
import { combineLatest, of } from 'rxjs';
import { catchError, delayWhen, switchMap, take, takeUntil } from 'rxjs/operators';
import { ConfirmDialogComponent } from '../../dialogs/confirm-dialog/confirm-dialog.component';
import { CreateDocumentDialogComponent } from '../../dialogs/create-document-dialog/create-document-dialog.component';
import { InvalidCsvDialogComponent } from '../../dialogs/invalid-csv-dialog/invalid-csv-dialog.component';
import { GenMapperContainerComponent } from '../../gen-mapper-container/gen-mapper-container.component';
import { GenMapperGraphComponent } from '../../gen-mapper-graph/gen-mapper-graph.component';
import { GenMapperView } from '../../gen-mapper-view.enum';
import { GenMapperService } from '../../gen-mapper.service';
import { NodeClipboardService } from '../../node-clipboard.service';
import { NodeTreeService } from '../../node-tree/node-tree.service';
import { SavingErrorSnackbarComponent, SavingErrorSnackBarConfig } from '../../snackbars/saving-error-snackbar/saving-error-snackbar.component';
import { SavingSnackbarComponent, SavingSnackBarConfig } from '../../snackbars/saving-snackbar/saving-snackbar.component';

@Component({
    selector: 'app-gen-mapper',
    templateUrl: './gen-mapper.component.html',
    styleUrls: ['./gen-mapper.component.scss'],
    providers: [NodeTreeService]
})
export class GenMapperComponent extends Unsubscribable implements OnInit {
    @ViewChild(GenMapperGraphComponent, { static: false })
    public genMapperGraph: GenMapperGraphComponent;

    @HostBinding('class.is-authenticated')
    public isAuthenticated: boolean;

    public template: Template;
    public node: NodeDto;
    public document: DocumentDto;
    public documents: DocumentDto[];
    public showMapView: boolean;
    public showReportsView: boolean;
    public viewTypes = GenMapperView;
    public view = GenMapperView.GenMap;

    private _savingSnackBar: MatSnackBarRef<SavingSnackbarComponent>;
    private _savingErrorSnackBar: MatSnackBarRef<SavingErrorSnackbarComponent>;

    private _localeId: string;

    constructor(
        private authService: AuthenticationService,
        private genMapper: GenMapperService,
        private router: Router,
        private dialog: MatDialog,
        private snackBar: MatSnackBar,
        private locale: LocaleService,
        private nodeTree: NodeTreeService,
        private nodeClipboard: NodeClipboardService,
        @Optional() public genMapperContainer: GenMapperContainerComponent
    ) {
        super();
        this.genMapperContainer.view = this.view;
    }

    public ngOnInit(): void {
        this.isAuthenticated = this.authService.isAuthenticated();

        combineLatest(
            this.genMapper.template$,
            this.locale.get(),
        )
            .pipe(takeUntil(this.unsubscribe))
            .subscribe((result: [Template, string]) => {
                const [template, locale] = result;
                this.template = template;
                this.nodeTree.createLayout(this.template);

                if (this.template.reports) {
                    this.showReportsView = true;
                }

                if (locale !== this._localeId) {
                    this._localeId = locale;
                    TemplateUtils.setTemplateLocale(this.template, this.locale);
                }
            });

        this.genMapper.selectedDocument$
            .pipe(takeUntil(this.unsubscribe))
            .subscribe(document => {
                this.document = document;
                if (!document && !this.authService.isAuthenticated() && this.genMapper.hasLocalDocument()) {
                    this.router.navigate(['/gen-mapper', this.template.id, 'local'], { skipLocationChange: true });
                }

                if (this.view === GenMapperView.Reports) {
                    this.view = GenMapperView.GenMap;
                }

                // Center Graph when document Changes
                if (this.genMapperGraph) {
                    this.genMapperGraph.recenterGraph();
                }
            });

        this.genMapper.nodes$
            .pipe(takeUntil(this.unsubscribe))
            .subscribe(nodes => {
                if (nodes && nodes.length) {
                    if (this.nodeTree.validateTree(nodes)) {
                        this.nodeTree.createTree(nodes);
                        this.checkAvailableViews();
                    }
                }
            });

        this.genMapper.selectedNode$
            .pipe(takeUntil(this.unsubscribe))
            .subscribe(result => {
                this.node = result;
            });

        this.genMapper.documents$
            .pipe(takeUntil(this.unsubscribe))
            .subscribe(documents => {
                this.documents = documents;
            });
    }

    public checkAvailableViews(): void {
        this.genMapper.nodes$.pipe(take(1)).subscribe(result => {
            this.showMapView = some(result, d => !!d.attributes.location);
        })
    }

    public setView(view: GenMapperView): void {
        if (this.document) {
            this.view = view;
            this.genMapperContainer.view = this.view;
        }
    }

    public onNodeClick(node: NodeDto): void {
        this.genMapper.setNode(node);
    }

    public onAddNode(parentNode: NodeDto): void {
        const newNode = this.template.createDefaultNode();
        newNode.parentId = parentNode.id;
        newNode.documentId = this.document.id;

        this.showSavingSnackBar();

        this.genMapper.createNode(newNode).subscribe(
            (node) => {
                this.dismissSavingSnackBar();
                this.nodeTree.insertNode(node);

                this.genMapperGraph.centerGraphOnNode(node.id);

                this.snackBar.open(this.locale.t('Common_ChildNodeAdded'), this.locale.t('Common_Undo'), { duration: 10000 }).onAction().subscribe(() => {
                    this.onDeleteNode(node);
                });
            },
            error => {
                this.showSavingErrorSnackBar();
            }
        );
    }

    public onUpdateNode(node: NodeDto): void {
        this.nodeTree.updateNode(node);

        this.showSavingSnackBar();
        this.genMapper.updateNode(node).subscribe(
            (success) => {
                this.dismissSavingSnackBar();
                this.checkAvailableViews();
            },
            (error) => this.showSavingErrorSnackBar()
        );
    }

    public onDeleteNode(node: NodeDto): void {
        const nodeDatum = this.nodeTree.getNodeDatumById(node.id);
        const name = nodeDatum.data.attributes.name || nodeDatum.data.attributes.leaderName || 'No Name';
        const hasChildren = nodeDatum.children && nodeDatum.children.length;
        const localeKey = hasChildren ? 'Message_confirmDeleteGroupWithChildren' : 'Message_confirmDeleteGroup';
        const message = this.locale.t(localeKey, { groupName: name });
        const descendants = nodeDatum.descendants().map(d => d.data);
        const items = descendants.map(d => d.attributes.name || d.attributes.leaderName || d.attributes.leadersName || 'No Name');

        this.dialog
            .open(ConfirmDialogComponent, {
                data: {
                    alert: message,
                    items: items,
                    title: this.locale.t('Message_confirmDelete', { groupName: name })
                }
            })
            .afterClosed()
            .subscribe(result => {
                if (result) {
                    this.showSavingSnackBar();
                    const idsToDelete = descendants.map(n => n.id);
                    this.genMapper.removeDocumentNodes(idsToDelete)
                        .pipe(delayWhen(() => this.genMapper.refreshDocumentNodes()))
                        .subscribe(
                            success => {
                                this.dismissSavingSnackBar();
                                this.genMapper.setNode(null);
                                this.snackBar
                                    .open(this.locale.t('Common_GroupDeleted'), this.locale.t('Common_Undo'), { duration: 10000 })
                                    .onAction()
                                    .subscribe(() => {
                                        this.showSavingSnackBar();
                                        this.genMapper.createDocumentNodes(descendants).subscribe(
                                            success => {
                                                this.dismissSavingSnackBar();
                                                this.genMapper.setNodeById(node.id);
                                            },
                                            error => {
                                                this.showSavingErrorSnackBar();
                                            }
                                        )
                                    });
                            },
                            error => {
                                this.showSavingErrorSnackBar();
                            }
                        );
                }
            });
    }

    public onCopyNode(node: NodeDto): void {
        const clonedData = this.nodeTree.cloneNodeTree(node);
        this.nodeClipboard.set(clonedData);
        this.snackBar.open(this.locale.t('Common_CopiedNodeToClipboard'), this.locale.t('Common_Ok'), { duration: 5000 });
    }

    public onReplaceNode(nodeToReplace: NodeDto): void {
        const nodeDatum = this.nodeTree.getNodeDatumById(nodeToReplace.id);
        const original = nodeDatum.descendants().map(d => d.data);
        const clonedData = this.nodeClipboard.getValue();
        const idsToDelete = original.map(n => n.id);

        const root = clonedData.find(d => !d.parentId);
        root.parentId = nodeToReplace.parentId;

        this.showSavingSnackBar();
        this.genMapper.removeDocumentNodes(idsToDelete)
            .pipe(
                switchMap(() => this.genMapper.createDocumentNodes(clonedData).pipe(
                    catchError(() => {
                        this.showSavingErrorSnackBar();
                        this.revertReplaceNode(original);
                        return null;
                    })
                )),
                catchError(() => {
                    this.showSavingErrorSnackBar();
                    return null;
                })
            )
            .subscribe(() => {
                this.dismissSavingSnackBar();
                this.snackBar
                    .open(this.locale.t('Common_NodeHasBeenReplaced'), this.locale.t('Common_Undo'), { duration: 20000 })
                    .onAction()
                    .subscribe(() => {
                        this.revertReplaceNode(original, clonedData);
                    });
            });
    }

    private revertReplaceNode(nodes: NodeDto[], nodesCreated?: NodeDto[]): void {
        this.showSavingSnackBar();

        let observer = of(null);
        if (nodesCreated) {
            observer = this.genMapper.removeDocumentNodes(nodesCreated.map(d => d.id));
        }

        observer.subscribe(() => {
            this.genMapper.createDocumentNodes(nodes).subscribe(
                success => {
                    this.dismissSavingSnackBar();
                },
                error => {
                    this.showSavingErrorSnackBar();
                }
            )
        });
    }

    public onPasteAsChildNode(node: NodeDto): void {
        const clonedData = this.nodeClipboard.getValue();

        const root = clonedData.find(d => !d.parentId);
        root.parentId = node.id;

        this.showSavingSnackBar();
        this.genMapper.createDocumentNodes(clonedData)
            .pipe(
                catchError(() => {
                    this.showSavingErrorSnackBar();
                    return null;
                })
            )
            .subscribe(() => {
                this.dismissSavingSnackBar();
                this.snackBar
                    .open(this.locale.t('Common_ChildNodeAdded'), this.locale.t('Common_Undo'), { duration: 20000 })
                    .onAction()
                    .subscribe(() => {
                        this.showSavingSnackBar();
                        this.genMapper.removeDocumentNodes(clonedData.map(d => d.id)).subscribe(
                            success => {
                                this.dismissSavingSnackBar();
                                this.genMapper.refreshDocumentNodes().subscribe();
                            },
                            error => {
                                this.showSavingErrorSnackBar();
                            }
                        )
                    });
            })
    }

    public onImportSubtree(content: string): void {
        if (!content) {
            return;
        }

        const parsedCSV = CSVToJSON(content, this.template);

        if (!this.nodeTree.validateTree(parsedCSV)) {
            return this.showBadDocumentDialog(content);
        }

        this.showSavingSnackBar();
        this.genMapper.importChildNodesFromCSV(this.node, parsedCSV)
            .subscribe(
                success => {
                    this.dismissSavingSnackBar();
                    const createdIds = success.map(n => n.id);
                    this.snackBar
                        .open(this.locale.t('Common_SubtreeImported'), this.locale.t('Common_Undo'), { duration: 10000 })
                        .onAction()
                        .subscribe(() => {
                            this.showSavingSnackBar();
                            this.genMapper.removeDocumentNodes(createdIds)
                                .subscribe(
                                    result => {
                                        this.dismissSavingSnackBar();
                                        this.genMapper.refreshDocumentNodes().subscribe();
                                    },
                                    error => {
                                        this.showSavingErrorSnackBar();
                                    }
                                );
                        });
                },
                error => {
                    this.showSavingErrorSnackBar();
                }
            )
    }

    public onCreateDocument(): void {
        this.dialog.open(CreateDocumentDialogComponent)
            .afterClosed()
            .subscribe(result => {
                if (result) {
                    this.createDocument(result);
                }
            });
    }

    public onImport(): void {
        this.dialog
            .open(FileInputDialogComponent)
            .afterClosed()
            .subscribe(result => {
                if (result) {
                    const nodes = CSVToJSON(result.content, this.template);
                    if (this.nodeTree.validateTree(nodes)) {
                        result.nodes = nodes;
                        this.createDocument(result);
                    } else {
                        this.showBadDocumentDialog(result.content);
                    }
                }
            });
    }

    public onNodeDrawerOpenChanged(opened: boolean): void {
        if (!opened) {
            this.genMapper.setNode(null);
        }
    }

    private createDocument(doc?: DocumentDto): void {
        this.genMapper.createDocument(doc).subscribe(result => {
            this.router.navigate(['/gen-mapper', this.template.name, result.id]);
        });
    }

    private showBadDocumentDialog(content: string): void {
        this.dialog.open(InvalidCsvDialogComponent, {
            data: { content }
        });
    }

    private showSavingSnackBar(): void {
        this.snackBar.dismiss();
        this._savingSnackBar = this.snackBar.openFromComponent(SavingSnackbarComponent, new SavingSnackBarConfig());
    }

    private dismissSavingSnackBar(): void {
        if (this._savingSnackBar) {
            this._savingSnackBar.dismiss();
            this._savingSnackBar = null;
        }
    }

    private showSavingErrorSnackBar(): void {
        this.snackBar.dismiss();
        this._savingErrorSnackBar = this.snackBar.openFromComponent(
            SavingErrorSnackbarComponent,
            new SavingErrorSnackBarConfig()
        );
    }
}