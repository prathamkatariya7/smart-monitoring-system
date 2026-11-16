import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, from } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { Db } from './db.service';

/**
 * Wraps every HTTP request's handler execution in an RLS-scoped transaction
 * (Part 4). AuthGuard must run first and attach `req.authContext` (set by
 * JwtAuthGuard from the verified access token + the user's laboratory scopes
 * loaded at login time, Part 3.1/4). Anonymous routes (login, health) get an
 * admin-false, empty-scope context, which reads nothing under RLS — correct,
 * since those routes do not query lab-scoped tables.
 */
@Injectable()
export class RlsInterceptor implements NestInterceptor {
  constructor(private readonly db: Db) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const authContext = req.authContext ?? {
      isAdmin: false,
      laboratoryIds: [],
      userId: undefined,
    };

    return from(
      this.db.runInContext(authContext, async () => {
        return new Promise((resolve, reject) => {
          next
            .handle()
            .subscribe({ next: resolve, error: reject });
        });
      }),
    ).pipe(switchMap((result) => from([result])));
  }
}
