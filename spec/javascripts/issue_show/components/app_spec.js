import Vue from 'vue';
import MockAdapter from 'axios-mock-adapter';
import axios from '~/lib/utils/axios_utils';
import '~/behaviors/markdown/render_gfm';
import issuableApp from '~/issue_show/components/app.vue';
import eventHub from '~/issue_show/event_hub';
import setTimeoutPromise from 'spec/helpers/set_timeout_promise_helper';
import issueShowData from '../mock_data';

function formatText(text) {
  return text.trim().replace(/\s\s+/g, ' ');
}

const REALTIME_REQUEST_STACK = [
  issueShowData.initialRequest,
  issueShowData.secondRequest,
];

describe('Issuable output', () => {
  let mock;
  let realtimeRequestCount = 0;
  let vm;

  document.body.innerHTML = '<span id="task_status"></span>';

  beforeEach((done) => {
    spyOn(eventHub, '$emit');

    const IssuableDescriptionComponent = Vue.extend(issuableApp);

    mock = new MockAdapter(axios);
    mock.onGet('/gitlab-org/gitlab-shell/issues/9/realtime_changes/realtime_changes').reply(() => {
      const res = Promise.resolve([200, REALTIME_REQUEST_STACK[realtimeRequestCount]]);
      realtimeRequestCount += 1;
      return res;
    });

    vm = new IssuableDescriptionComponent({
      propsData: {
        canUpdate: true,
        canDestroy: true,
        endpoint: '/gitlab-org/gitlab-shell/issues/9/realtime_changes',
        updateEndpoint: gl.TEST_HOST,
        issuableRef: '#1',
        initialTitleHtml: '',
        initialTitleText: '',
        initialDescriptionHtml: 'test',
        initialDescriptionText: 'test',
        markdownPreviewPath: '/',
        markdownDocsPath: '/',
        projectNamespace: '/',
        projectPath: '/',
      },
    }).$mount();

    setTimeout(done);
  });

  afterEach(() => {
    mock.restore();
    realtimeRequestCount = 0;

    vm.poll.stop();
    vm.$destroy();
  });

  it('should render a title/description/edited and update title/description/edited on update', (done) => {
    let editedText;
    Vue.nextTick()
    .then(() => {
      editedText = vm.$el.querySelector('.edited-text');
    })
    .then(() => {
      expect(document.querySelector('title').innerText).toContain('this is a title (#1)');
      expect(vm.$el.querySelector('.title').innerHTML).toContain('<p>this is a title</p>');
      expect(vm.$el.querySelector('.wiki').innerHTML).toContain('<p>this is a description!</p>');
      expect(vm.$el.querySelector('.js-task-list-field').value).toContain('this is a description');
      expect(formatText(editedText.innerText)).toMatch(/Edited[\s\S]+?by Some User/);
      expect(editedText.querySelector('.author-link').href).toMatch(/\/some_user$/);
      expect(editedText.querySelector('time')).toBeTruthy();
    })
    .then(() => {
      vm.poll.makeRequest();
    })
    .then(() => new Promise(resolve => setTimeout(resolve)))
    .then(() => {
      expect(document.querySelector('title').innerText).toContain('2 (#1)');
      expect(vm.$el.querySelector('.title').innerHTML).toContain('<p>2</p>');
      expect(vm.$el.querySelector('.wiki').innerHTML).toContain('<p>42</p>');
      expect(vm.$el.querySelector('.js-task-list-field').value).toContain('42');
      expect(vm.$el.querySelector('.edited-text')).toBeTruthy();
      expect(formatText(vm.$el.querySelector('.edited-text').innerText)).toMatch(/Edited[\s\S]+?by Other User/);
      expect(editedText.querySelector('.author-link').href).toMatch(/\/other_user$/);
      expect(editedText.querySelector('time')).toBeTruthy();
    })
    .then(done)
    .catch(done.fail);
  });

  it('shows actions if permissions are correct', (done) => {
    vm.showForm = true;

    Vue.nextTick(() => {
      expect(
        vm.$el.querySelector('.btn'),
      ).not.toBeNull();

      done();
    });
  });

  it('does not show actions if permissions are incorrect', (done) => {
    vm.showForm = true;
    vm.canUpdate = false;

    Vue.nextTick(() => {
      expect(
        vm.$el.querySelector('.btn'),
      ).toBeNull();

      done();
    });
  });

  it('does not update formState if form is already open', (done) => {
    vm.openForm();

    vm.state.titleText = 'testing 123';

    vm.openForm();

    Vue.nextTick(() => {
      expect(
        vm.store.formState.title,
      ).not.toBe('testing 123');

      done();
    });
  });

  describe('updateIssuable', () => {
    it('fetches new data after update', (done) => {
      spyOn(vm.service, 'getData').and.callThrough();
      spyOn(vm.service, 'updateIssuable').and.callFake(() => new Promise((resolve) => {
        resolve({
          data: {
            confidential: false,
            web_url: window.location.pathname,
          },
        });
      }));

      vm.updateIssuable()
        .then(() => {
          expect(vm.service.getData).toHaveBeenCalled();
        })
        .then(done)
        .catch(done.fail);
    });

    it('correctly updates issuable data', (done) => {
      spyOn(vm.service, 'updateIssuable').and.callFake(() => new Promise((resolve) => {
        resolve();
      }));

      vm.updateIssuable()
        .then(() => {
          expect(vm.service.updateIssuable).toHaveBeenCalledWith(vm.formState);
          expect(eventHub.$emit).toHaveBeenCalledWith('close.form');
        })
        .then(done)
        .catch(done.fail);
    });

    it('does not redirect if issue has not moved', (done) => {
      const visitUrl = spyOnDependency(issuableApp, 'visitUrl');
      spyOn(vm.service, 'updateIssuable').and.callFake(() => new Promise((resolve) => {
        resolve({
          data: {
            web_url: window.location.pathname,
            confidential: vm.isConfidential,
          },
        });
      }));

      vm.updateIssuable();

      setTimeout(() => {
        expect(visitUrl).not.toHaveBeenCalled();
        done();
      });
    });

    it('redirects if returned web_url has changed', (done) => {
      const visitUrl = spyOnDependency(issuableApp, 'visitUrl');
      spyOn(vm.service, 'updateIssuable').and.callFake(() => new Promise((resolve) => {
        resolve({
          data: {
            web_url: '/testing-issue-move',
            confidential: vm.isConfidential,
          },
        });
      }));

      vm.updateIssuable();

      setTimeout(() => {
        expect(visitUrl).toHaveBeenCalledWith('/testing-issue-move');
        done();
      });
    });

    describe('shows dialog when issue has unsaved changed', () => {
      it('confirms on title change', (done) => {
        vm.showForm = true;
        vm.state.titleText = 'title has changed';
        const e = { returnValue: null };
        vm.handleBeforeUnloadEvent(e);
        Vue.nextTick(() => {
          expect(e.returnValue).not.toBeNull();
          done();
        });
      });

      it('confirms on description change', (done) => {
        vm.showForm = true;
        vm.state.descriptionText = 'description has changed';
        const e = { returnValue: null };
        vm.handleBeforeUnloadEvent(e);
        Vue.nextTick(() => {
          expect(e.returnValue).not.toBeNull();
          done();
        });
      });

      it('does nothing when nothing has changed', (done) => {
        const e = { returnValue: null };
        vm.handleBeforeUnloadEvent(e);
        Vue.nextTick(() => {
          expect(e.returnValue).toBeNull();
          done();
        });
      });
    });

    describe('error when updating', () => {
      beforeEach(() => {
        spyOn(window, 'Flash').and.callThrough();
        spyOn(vm.service, 'updateIssuable').and.callFake(() => new Promise((resolve, reject) => {
          reject();
        }));
      });

      it('closes form on error', (done) => {
        vm.updateIssuable();

        setTimeout(() => {
          expect(
            eventHub.$emit,
          ).toHaveBeenCalledWith('close.form');
          expect(
            window.Flash,
          ).toHaveBeenCalledWith('Error updating issue');

          done();
        });
      });

      it('returns the correct error message for issuableType', (done) => {
        vm.issuableType = 'merge request';

        Vue.nextTick(() => {
          vm.updateIssuable();

          setTimeout(() => {
            expect(
              eventHub.$emit,
            ).toHaveBeenCalledWith('close.form');
            expect(
              window.Flash,
            ).toHaveBeenCalledWith('Error updating merge request');

            done();
          });
        });
      });
    });
  });

  it('opens recaptcha modal if update rejected as spam', (done) => {
    function mockScriptSrc() {
      const recaptchaChild = vm.$children
        .find(child => child.$options._componentTag === 'recaptcha-modal'); // eslint-disable-line no-underscore-dangle

      recaptchaChild.scriptSrc = '//scriptsrc';
    }

    let modal;
    const promise = new Promise((resolve) => {
      resolve({
        data: {
          recaptcha_html: '<div class="g-recaptcha">recaptcha_html</div>',
        },
      });
    });

    spyOn(vm.service, 'updateIssuable').and.returnValue(promise);

    vm.canUpdate = true;
    vm.showForm = true;

    vm.$nextTick()
      .then(() => mockScriptSrc())
      .then(() => vm.updateIssuable())
      .then(promise)
      .then(() => setTimeoutPromise())
      .then(() => {
        modal = vm.$el.querySelector('.js-recaptcha-modal');

        expect(modal.style.display).not.toEqual('none');
        expect(modal.querySelector('.g-recaptcha').textContent).toEqual('recaptcha_html');
        expect(document.body.querySelector('.js-recaptcha-script').src).toMatch('//scriptsrc');
      })
      .then(() => modal.querySelector('.close').click())
      .then(() => vm.$nextTick())
      .then(() => {
        expect(modal.style.display).toEqual('none');
        expect(document.body.querySelector('.js-recaptcha-script')).toBeNull();
      })
      .then(done)
      .catch(done.fail);
  });

  describe('deleteIssuable', () => {
    it('changes URL when deleted', (done) => {
      const visitUrl = spyOnDependency(issuableApp, 'visitUrl');
      spyOn(vm.service, 'deleteIssuable').and.callFake(() => new Promise((resolve) => {
        resolve({
          data: {
            web_url: '/test',
          },
        });
      }));

      vm.deleteIssuable();

      setTimeout(() => {
        expect(visitUrl).toHaveBeenCalledWith('/test');
        done();
      });
    });

    it('stops polling when deleting', (done) => {
      spyOnDependency(issuableApp, 'visitUrl');
      spyOn(vm.poll, 'stop').and.callThrough();
      spyOn(vm.service, 'deleteIssuable').and.callFake(() => new Promise((resolve) => {
        resolve({
          data: {
            web_url: '/test',
          },
        });
      }));

      vm.deleteIssuable();

      setTimeout(() => {
        expect(
          vm.poll.stop,
        ).toHaveBeenCalledWith();
        done();
      });
    });

    it('closes form on error', (done) => {
      spyOn(window, 'Flash').and.callThrough();
      spyOn(vm.service, 'deleteIssuable').and.callFake(() => new Promise((resolve, reject) => {
        reject();
      }));

      vm.deleteIssuable();

      setTimeout(() => {
        expect(
          eventHub.$emit,
        ).toHaveBeenCalledWith('close.form');
        expect(
          window.Flash,
        ).toHaveBeenCalledWith('Error deleting issue');

        done();
      });
    });
  });

  describe('open form', () => {
    it('shows locked warning if form is open & data is different', (done) => {
      vm.$nextTick()
        .then(() => {
          vm.openForm();

          vm.poll.makeRequest();
        })
        // Wait for the request
        .then(vm.$nextTick)
        // Wait for the successCallback to update the store state
        .then(vm.$nextTick)
        // Wait for the new state to flow to the Vue components
        .then(vm.$nextTick)
        .then(() => {
          expect(vm.formState.lockedWarningVisible).toEqual(true);
          expect(vm.$el.querySelector('.alert')).not.toBeNull();
        })
        .then(done)
        .catch(done.fail);
    });
  });

  describe('show inline edit button', () => {
    it('should not render by default', () => {
      expect(vm.$el.querySelector('.title-container .note-action-button')).toBeDefined();
    });

    it('should render if showInlineEditButton', () => {
      vm.showInlineEditButton = true;
      expect(vm.$el.querySelector('.title-container .note-action-button')).toBeDefined();
    });
  });
});
