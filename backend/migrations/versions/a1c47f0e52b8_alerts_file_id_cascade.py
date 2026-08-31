"""alerts.file_id: ON DELETE CASCADE + index; files.size -> BigInteger

Revision ID: a1c47f0e52b8
Revises: 0d6439d2e79f
Create Date: 2026-08-31 12:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'a1c47f0e52b8'
down_revision: Union[str, Sequence[str], None] = '0d6439d2e79f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.drop_constraint('alerts_file_id_fkey', 'alerts', type_='foreignkey')
    op.create_foreign_key(
        'alerts_file_id_fkey', 'alerts', 'files', ['file_id'], ['id'], ondelete='CASCADE'
    )
    op.create_index(op.f('ix_alerts_file_id'), 'alerts', ['file_id'], unique=False)
    op.alter_column(
        'files', 'size',
        existing_type=sa.Integer(),
        type_=sa.BigInteger(),
        existing_nullable=False,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.alter_column(
        'files', 'size',
        existing_type=sa.BigInteger(),
        type_=sa.Integer(),
        existing_nullable=False,
    )
    op.drop_index(op.f('ix_alerts_file_id'), table_name='alerts')
    op.drop_constraint('alerts_file_id_fkey', 'alerts', type_='foreignkey')
    op.create_foreign_key('alerts_file_id_fkey', 'alerts', 'files', ['file_id'], ['id'])
