import { Injectable } from '@angular/core';
import { AuthenticationService } from '@core/authentication.service';
import { DocumentDto } from '@shared/entity/document.model';
import { Entity } from '@shared/entity/entity.model';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { delayWhen, tap } from 'rxjs/operators';

import { DocumentService } from './document.service';
import { GMTemplate } from './gen-mapper.interface';
import { TemplateUtils } from './template-utils';

const storageKey = 'offline-locall-save-';

export interface GenMapperConfig {
    documents: DocumentDto[];
    template: GMTemplate;
}

@Injectable()
export class GenMapperService {
    private _config: BehaviorSubject<GenMapperConfig> = new BehaviorSubject({} as GenMapperConfig);
    private _document: BehaviorSubject<DocumentDto> = new BehaviorSubject(null);

    constructor(
        private authService: AuthenticationService,
        private documentService: DocumentService
    ) { }

    public getDocument(): Observable<DocumentDto> {
        return this._document.asObservable();
    }

    public getConfig(): Observable<GenMapperConfig> {
        return this._config.asObservable();
    }

    public setConfig(config: GenMapperConfig): void {
        this._config.next(config);
    }

    public setDocument(document: DocumentDto): void {
        this._document.next(document);
    }

    public load(template: GMTemplate): Observable<DocumentDto[]> {

        if (!this.authService.isAuthenticated()) {
            return this.loadFromLocalStorage(template);
        }

        return this.documentService.getDocumentsByType(template.format)
            .pipe(
                tap((docs) => {
                    const config = this._config.getValue();
                    config.documents = docs;
                    config.template = template;
                    this.setConfig(config);
                })
            );
    }

    public loadFromLocalStorage(template: GMTemplate): Observable<DocumentDto[]> {
        const local = localStorage.getItem(storageKey + template.name);
        let document: DocumentDto;

        if (local) {
            const json = JSON.parse(local);

            // For backwards compatibility
            if (json.format) { json.type = json.format; }

            document = new DocumentDto(json);
        } else {
            document = new DocumentDto({ type: template.format, id: Entity.uuid() });
        }

        const config = this._config.getValue();
        config.documents = [document];
        config.template = template;
        this.setConfig(config);

        return of(config.documents);
    }

    public createDocument(value: { content?: string, title?: string } = {}): Observable<DocumentDto> {
        const config = this._config.getValue();

        const doc = new DocumentDto({
            id: Entity.uuid(),
            title: value.title || 'No name',
            type: config.template.format,
            content: value.content || TemplateUtils.createInitialCSV(config.template)
        });

        if (!this.authService.isAuthenticated()) {
            return this.updateLocalStorage(doc)
                .pipe(
                    delayWhen(() => this.load(config.template))
                );
        }

        return this.documentService.create(doc, config.template)
            .pipe(
                delayWhen(() => this.load(config.template))
            );
    }

    public updateDocument(doc: DocumentDto): Observable<DocumentDto> {
        if (!this.authService.isAuthenticated()) {
            return this.updateLocalStorage(doc);
        }

        return this.documentService.update(doc);
    }

    public updateLocalStorage(doc: DocumentDto): Observable<DocumentDto> {
        const config = this._config.getValue();
        doc.id = 'local';
        localStorage.setItem(storageKey + config.template.name, JSON.stringify(doc));
        return of(doc);
    }

    public removeDocument(doc: DocumentDto): Observable<DocumentDto> {
        const config = this._config.getValue();

        if (!this.authService.isAuthenticated()) {
            return this.removeLocalDocument(doc)
                .pipe(
                    delayWhen(() => this.load(config.template)),
                    tap(() => this._document.next(null))
                );
        }

        return this.documentService.remove(doc)
            .pipe(
                delayWhen(() => this.load(config.template)),
                tap(() => this._document.next(null))
            );
    }

    public removeLocalDocument(doc: DocumentDto): Observable<DocumentDto> {
        const config = this._config.getValue();
        localStorage.removeItem(storageKey + config.template.name);
        return of(doc);
    }

    public hasLocalDocument(): boolean {
        const config = this._config.getValue();
        return !!localStorage.getItem(storageKey + config.template.name);
    }
}