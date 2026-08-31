from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Query


@dataclass
class Pagination:
    limit: Annotated[int, Query(ge=1, le=1000)] = 100
    offset: Annotated[int, Query(ge=0)] = 0


PaginationDep = Annotated[Pagination, Depends()]
