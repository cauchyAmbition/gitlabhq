require 'spec_helper'

describe Users::UpdateService do
  let(:user) { create(:user) }

  describe '#execute' do
    it 'updates the name' do
      result = update_user(user, name: 'New Name')

      expect(result).to eq(status: :success)
      expect(user.name).to eq('New Name')
    end

    it 'returns an error result when record cannot be updated' do
      expect do
        update_user(user, { email: 'invalid' })
      end.not_to change { user.reload.email }
    end

    def update_user(user, opts)
      described_class.new(user, opts).execute
    end
  end

  describe '#execute!' do
    it 'updates the name' do
      service = described_class.new(user, name: 'New Name')
      expect(service).not_to receive(:notify_new_user)

      result = service.execute!

      expect(result).to be true
      expect(user.name).to eq('New Name')
    end

    it 'raises an error when record cannot be updated' do
      expect do
        update_user(user, email: 'invalid')
      end.to raise_error(ActiveRecord::RecordInvalid)
    end

    it 'fires system hooks when a new user is saved' do
      system_hook_service = spy(:system_hook_service)
      user = build(:user)
      service = described_class.new(user, name: 'John Doe')
      expect(service).to receive(:notify_new_user).and_call_original
      expect(service).to receive(:system_hook_service).and_return(system_hook_service)

      service.execute

      expect(system_hook_service).to have_received(:execute_hooks_for).with(user, :create)
    end

    def update_user(user, opts)
      described_class.new(user, opts).execute!
    end
  end
end
